#!/bin/bash

# Online Radio Box Shell Scraper
# Usage: ./onlineradiobox.sh [country_code] [country_name] [max_pages]

CODE=${1:-"in"}
NAME=${2:-"India"}
MAX_PAGES=${3:-1000}

# Find project root (4 levels up from this script: scrapers/providers/onlineradiobox/ -> scrapers/)
PROJECT_ROOT=$(cd "$(dirname "$0")/../../../../" && pwd)
SCRAPER_DIR="$(dirname "$0")"
OUTPUT_DIR="$SCRAPER_DIR/data"
OUTPUT_FILE="$OUTPUT_DIR/${CODE^^}.json" # Use uppercase ISO code for filename
BASE_URL="https://onlineradiobox.com/$CODE/"
FETCHER="npx tsx $SCRAPER_DIR/orb_fetcher.js"

# Colors (Premium Palette)
GREEN=$'\033[1;32m'
RED=$'\033[1;31m'
CYAN=$'\033[1;36m'
YELLOW=$'\033[1;33m'
BLUE=$'\033[1;34m'
MAGENTA=$'\033[1;35m'
GRAY=$'\033[0;90m'
WHITE=$'\033[1;37m'
NC=$'\033[0m'

# -------- TABLE CONFIG --------
COL_IDX=4
COL_NAME=42
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

    # Strip ANSI from colored status for alignment calculation
    local clean_status
    clean_status=$(echo -e "$status_colored" | sed 's/\x1b\[[0-9;]*m//g')

    # Re-apply color based on status content
    local color_code="${RED}"
    if [[ "$status_colored" == *"$GREEN"* ]]; then
        color_code="${GREEN}"
    fi

    # Print the row with colored borders and values
    printf "${GRAY}|${NC} ${BLUE}%-${COL_IDX}s${NC} ${GRAY}|${NC} ${CYAN}%-${COL_NAME}.${COL_NAME}s${NC} ${GRAY}|${NC} %b%-${COL_STATUS}s${NC} ${GRAY}|${NC} ${MAGENTA}%-${COL_FORMAT}s${NC} ${GRAY}|${NC}\n" \
        "$idx" "$name" "$color_code" "$clean_status" "$format"
}
# --------------------------------

mkdir -p "$OUTPUT_DIR"

echo -e "${CYAN}==================================================${NC}"
echo -e "${YELLOW}Scraping $NAME ($CODE) - Auto Pagination${NC}"
echo -e "${CYAN}==================================================${NC}"

TMP_LIST=$(mktemp)
PREVIOUS_FIRST_ID=""

# Start with the initial URL (allow override via 4th arg)
START_URL=${4:-"$BASE_URL"}
CURRENT_URL="$START_URL"

for ((p=0; p<MAX_PAGES; p++)); do
    echo -e "\n${CYAN}Fetching page $p:${NC} $CURRENT_URL"
    print_header

    HAS_CONTINUE="false"
    STATIONS_FOUND=0
    CURRENT_PAGE_FIRST_ID=""
    NEXT_URL=""

    # Fetch page data and store in a temporary file
    LIST_OUT=$(mktemp)
    $FETCHER "$CURRENT_URL" "country" > "$LIST_OUT"
    
    if [[ ! -s "$LIST_OUT" ]]; then
        echo -e "${RED}No stations found on this page. Stopping.${NC}"
        rm -f "$LIST_OUT"
        break
    fi

    # Batch fetch websites for all stations on this page
    ORB_URLS=$(jq -r '.orbUrl' "$LIST_OUT" | paste -sd "," -)
    WEBSITES_OUT=$(mktemp)
    if [[ -n "$ORB_URLS" ]]; then
        echo -e "${YELLOW}Batch fetching official websites for $(jq -s 'length' "$LIST_OUT") stations...${NC}"
        $FETCHER "$ORB_URLS" "station" > "$WEBSITES_OUT"
    fi

    while read -r line; do
        [[ -z "$line" ]] && continue
        ((STATIONS_FOUND++))

        ID=$(echo "$line" | jq -r .internalId)
        STATION_NAME=$(echo "$line" | jq -r .name)
        IMAGE=$(echo "$line" | jq -r .image)
        # Normalize image URL
        [[ "$IMAGE" == //* ]] && IMAGE="https:$IMAGE"
        
        STREAM=$(echo "$line" | jq -r .stream)
        GENRES=$(echo "$line" | jq -c .genres)
        ORB_URL=$(echo "$line" | jq -r .orbUrl)
        HAS_CONTINUE=$(echo "$line" | jq -r ._hasMore)
        
        # Get the corresponding website from batch results
        WEBSITE=$(sed -n "${STATIONS_FOUND}p" "$WEBSITES_OUT" | jq -r .website 2>/dev/null || echo "")
        ACTIVE_PAGE=$(echo "$line" | jq -r ._activePage)
        NEXT_URL=$(echo "$line" | jq -r ._nextUrl)

        # Safety break if we are stuck on the same page (using both ID and page number)
        if [[ "$STATIONS_FOUND" -eq 1 ]]; then
            CURRENT_PAGE_FIRST_ID="$ID"
            if [[ -n "$PREVIOUS_FIRST_ID" && "$CURRENT_PAGE_FIRST_ID" == "$PREVIOUS_FIRST_ID" ]]; then
                # Only stop if the active page number also hasn't changed (truly stuck)
                if [[ -n "$PREVIOUS_PAGE_NUM" && "$ACTIVE_PAGE" == "$PREVIOUS_PAGE_NUM" ]]; then
                    echo "Duplicate content and page detected. Stopping."
                    STATIONS_FOUND=-1
                    break
                fi
            fi
            PREVIOUS_FIRST_ID="$CURRENT_PAGE_FIRST_ID"
            PREVIOUS_PAGE_NUM="$ACTIVE_PAGE"
        fi

        LOG_NAME=$(echo "$STATION_NAME" | cut -c1-42)

        # Skip testing for speed; ingest.py handles validation
        STATUS="untested"
        FORMAT="unknown"
        STATUS_COLORED="${GRAY}untested${NC}"

        print_row "$STATIONS_FOUND" "$LOG_NAME" "$STATUS_COLORED" "$FORMAT"

        # ---------- JSON BUILD ----------
        STATION_JSON=$(jq -n \
            --arg id "onlineradiobox_$ID" \
            --arg name "$STATION_NAME" \
            --arg img "$IMAGE" \
            --arg url "$STREAM" \
            --arg web "$WEBSITE" \
            --arg country "$NAME" \
            --arg status "$STATUS" \
            --arg codec "$FORMAT" \
            --arg date "$(date -Is)" \
            --argjson genres "$GENRES" \
            '{
                id: $id,
                name: $name,
                image: $img,
                stream_url: $url,
                website: $web,
                provider: "onlineradiobox",
                country: $country,
                genres: $genres,
                languages: [],
                description: "",
                status: $status,
                codec: $codec,
                last_tested_at: $date
            }')

        echo "$STATION_JSON" >> "$TMP_LIST"

    done < "$LIST_OUT"

    # Cleanup page-specific temp files
    rm -f "$LIST_OUT" "$WEBSITES_OUT"

    print_separator

    if [[ "$STATIONS_FOUND" -le 0 && "$STATIONS_FOUND" -ne -1 ]]; then
        echo "No more unique stations found."
        break
    fi

    if [[ "$STATIONS_FOUND" -eq -1 ]]; then
        echo "Safety break: End of unique content reached."
        break
    fi

    if [[ "$HAS_CONTINUE" != "true" || -z "$NEXT_URL" || "$NEXT_URL" == "null" ]]; then
        echo "No next page. Finished."
        break
    fi

    # Update URL for next iteration
    CURRENT_URL="$NEXT_URL"
done

# ---------- FINAL JSON ----------
if [ -s "$TMP_LIST" ]; then
    jq -s 'unique_by(.id)' "$TMP_LIST" > "$OUTPUT_FILE"
    COUNT=$(jq '. | length' "$OUTPUT_FILE")
    echo -e "\n${GREEN}Saved $COUNT stations to $OUTPUT_FILE${NC}"
else
    echo -e "${RED}No stations scraped.${NC}"
fi

rm -f "$TMP_LIST"
