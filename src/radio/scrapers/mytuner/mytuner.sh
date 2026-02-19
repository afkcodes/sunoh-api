#!/bin/bash

# MyTuner Radio Scraper (Optimized Batch Mode)
# Usage: ./mytuner.sh <code> <name> [max_pages]

CODE=$1
NAME=$2
MAX_PAGES=${3:-10}

if [[ -z "$CODE" || -z "$NAME" ]]; then
    echo "Usage: $0 <code> <name> [max_pages]"
    exit 1
fi

FETCHER="node $(dirname "$0")/mytuner_fetcher.js"
OUTPUT_DIR="scraped_data/$NAME"
OUTPUT_FILE="$OUTPUT_DIR/mytuner.json"
STATIONS_JSON="[]"

mkdir -p "$OUTPUT_DIR"

# Colors
GRAY=$'\033[0;90m'
WHITE=$'\033[1;37m'
CYAN=$'\033[1;36m'
BLUE=$'\033[1;34m'
GREEN=$'\033[1;32m'
RED=$'\033[1;31m'
MAGENTA=$'\033[1;35m'
YELLOW=$'\033[1;33m'
NC=$'\033[0m'

COL_IDX=4
COL_NAME=44
COL_STATUS=10
COL_FORMAT=12

print_separator() {
    echo -ne "${GRAY}"
    printf "+-%-${COL_IDX}s-+-%-${COL_NAME}s-+-%-${COL_STATUS}s-+-%-${COL_FORMAT}s-+\n" \
        "$(printf '%*s' $COL_IDX '' | tr ' ' '-')" \
        "$(printf '%*s' $COL_NAME '' | tr ' ' '-')" \
        "$(printf '%*s' $COL_STATUS '' | tr ' ' '-')" \
        "$(printf '%*s' $COL_FORMAT '' | tr ' ' '-')"
    echo -ne "${NC}"
}

print_header() {
    print_separator
    printf "${GRAY}|${NC} ${WHITE}%-${COL_IDX}s${NC} ${GRAY}|${NC} ${WHITE}%-${COL_NAME}s${NC} ${GRAY}|${NC} ${WHITE}%-${COL_STATUS}s${NC} ${GRAY}|${NC} ${WHITE}%-${COL_FORMAT}s${NC} ${GRAY}|${NC}\n" \
        "No" "Station" "Status" "Format"
    print_separator
}

print_row() {
    local idx="$1"
    local name="$2"
    local status_colored="$3"
    local format="$4"
    local clean_status
    clean_status=$(echo -e "$status_colored" | sed 's/\x1b\[[0-9;]*m//g')
    local color_code="${RED}"
    if [[ "$status_colored" == *"$GREEN"* ]]; then color_code="${GREEN}"; fi
    printf "${GRAY}|${NC} ${BLUE}%-${COL_IDX}s${NC} ${GRAY}|${NC} ${CYAN}%-44.44s${NC} ${GRAY}|${NC} %b%-${COL_STATUS}s${NC} ${GRAY}|${NC} ${MAGENTA}%-${COL_FORMAT}s${NC} ${GRAY}|${NC}\n" \
        "$idx" "$name" "$color_code" "$clean_status" "$format"
}

echo -e "${CYAN}==================================================${NC}"
echo -e "${YELLOW}Scraping MyTuner $NAME ($CODE)${NC}"
echo -e "${CYAN}==================================================${NC}"

PAGE_URL="https://mytuner-radio.com/radio/country/${CODE}-stations"
PAGES_SCRAPED=0
STATION_TOTAL=0

while [[ $PAGES_SCRAPED -lt $MAX_PAGES && -n "$PAGE_URL" ]]; do
    echo -e "${CYAN}Fetching page $((PAGES_SCRAPED + 1)):${NC} $PAGE_URL"
    
    LIST_RESULT=$($FETCHER "$PAGE_URL" "country")
    if [[ $? -ne 0 || -z "$LIST_RESULT" ]]; then
        echo -e "${RED}Error fetching listing. URL: $PAGE_URL${NC}"
        break
    fi

    # Extract station URLs to a comma-separated string for batch fetching
    STATION_URLS_CSV=$(echo "$LIST_RESULT" | jq -r '.stations[].url' | paste -sd "," -)
    
    if [[ -z "$STATION_URLS_CSV" ]]; then
        echo -e "${YELLOW}No stations found on this page.${NC}"
        break
    fi

    print_header
    
    # Batch fetch all station details in one browser session
    $FETCHER "$STATION_URLS_CSV" "station" | while read -r DETAIL; do
        if [[ -z "$DETAIL" || "$DETAIL" == *"error"* ]]; then continue; fi

        ((STATION_TOTAL++))
        S_NAME=$(echo "$DETAIL" | jq -r '.name')
        
        # Get all streams as a list
        S_STREAMS=$(echo "$DETAIL" | jq -c '.streams[]')
        
        if [[ -z "$S_STREAMS" ]]; then
            print_row "$STATION_TOTAL" "$S_NAME" "${RED}no stream${NC}" "---"
            continue
        fi

        WORKING_STREAM=""
        WORKING_FORMAT="N/A"
        WORKING_STATUS="${RED}broken${NC}"

        # Loop through each stream and test until one works
        while read -r STREAM_OBJ; do
            S_URL=$(echo "$STREAM_OBJ" | jq -r '.url')
            
            if [[ "$S_URL" == "null" || -z "$S_URL" ]]; then continue; fi

            # ---------- STREAM VALIDATION (FFPROBE ONLY) ----------
            CODEC="unknown"
            FOUND=0

            # Use ffprobe with a real User-Agent
            UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
            PROBE_OUT=$(timeout 8 ffprobe -user_agent "$UA" -v error -select_streams a:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "$S_URL" 2>&1)
            
            # Stricter check: Output must not be empty, must not contain error/fail, and no spaces/brackets
            if [[ -n "$PROBE_OUT" ]] && \
               [[ ! "${PROBE_OUT,,}" =~ "error" ]] && \
               [[ ! "${PROBE_OUT,,}" =~ "fail" ]] && \
               [[ ! "$PROBE_OUT" =~ "[" ]] && \
               [[ ! "$PROBE_OUT" =~ " " ]]; then
                CODEC="$PROBE_OUT"
                FOUND=1
            fi

            if [[ $FOUND -eq 1 ]]; then
                WORKING_STREAM="$S_URL"
                WORKING_FORMAT="$CODEC"
                WORKING_STATUS="${GREEN}working${NC}"
                break # Found a working stream!
            fi
        done <<< "$S_STREAMS"

        print_row "$STATION_TOTAL" "$S_NAME" "$WORKING_STATUS" "$WORKING_FORMAT"
        
        # Build JSON item with the verified working stream info
        STATION_JSON=$(echo "$DETAIL" | jq --arg status "$WORKING_STATUS" \
                                          --arg codec "$WORKING_FORMAT" \
                                          --arg best_url "$WORKING_STREAM" \
                                          '. + {status: $status, codec: $codec, verified_url: $best_url}')
        STATIONS_JSON=$(echo "$STATIONS_JSON" | jq --argjson item "$STATION_JSON" '. += [$item]')
    done
    print_separator
    
    # Save progress after each page
    echo "$STATIONS_JSON" > "$OUTPUT_FILE"

    # Next page?
    PAGE_URL=$(echo "$LIST_RESULT" | jq -r '.nextPage')
    ((PAGES_SCRAPED++))
done

if [ "$STATION_TOTAL" -gt 0 ]; then
    echo -e "\n${GREEN}Scrape complete! Saved $STATION_TOTAL stations to $OUTPUT_FILE${NC}"
else
    echo -e "\n${RED}No stations scraped.${NC}"
fi
