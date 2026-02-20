#!/bin/bash

# Main runner for all radio scrapers (Parallel Version)
# Usage: ./run_all.sh [parallel_jobs]

MAX_JOBS=${1:-5}
SCRAPER_DIR="$(dirname "$0")"
CORE_DIR="$SCRAPER_DIR/core"
COUNTRIES_FILE="$CORE_DIR/countries.txt"

# Colors
export GREEN=$'\033[1;32m'
export RED=$'\033[1;31m'
export CYAN=$'\033[1;36m'
export YELLOW=$'\033[1;33m'
export BLUE=$'\033[1;34m'
export GRAY=$'\033[0;90m'
export WHITE=$'\033[1;37m'
export NC=$'\033[0m'

if [ ! -f "$COUNTRIES_FILE" ]; then
    echo -e "${RED}Countries file not found: $COUNTRIES_FILE${NC}"
    exit 1
fi

echo -e "${CYAN}==================================================${NC}"
echo -e "${YELLOW}Starting Parallel Radio Scrape${NC}"
echo -e "${BLUE}Max Parallel Jobs: ${WHITE}$MAX_JOBS${NC}"
echo -e "${CYAN}==================================================${NC}"

# Function to process one country
process_country() {
    local code="$1"
    local name="$2"
    local scraper_bin="$3"
    
    local provider_dir=$(dirname "$scraper_bin")
    local output_file="$provider_dir/data/${code^^}.json"
    local log_dir="$provider_dir/logs"
    local log_file="$log_dir/${code^^}.log"
    
    mkdir -p "$log_dir"
    mkdir -p "$(dirname "$output_file")"
    
    if [ -f "$output_file" ]; then
        echo -e "${GRAY}[SKIP]${NC} $name"
        return
    fi
    
    echo -e "${YELLOW}[START]${NC} $name (Log: $log_file)"
    
    # Run the scraper and capture output to its own log
    "$scraper_bin" "$code" "$name" > "$log_file" 2>&1
    
    if [ $? -eq 0 ]; then
        local count=$(jq '. | length' "$output_file" 2>/dev/null || echo "0")
        echo -e "${GREEN}[DONE]${NC} $name ($count stations)"
    else
        echo -e "${RED}[FAIL]${NC} $name (Check $log_file)"
    fi
}

export -f process_country

# Job management
count=0
while IFS=: read -r code name; do
    # Skip empty lines or comments
    [[ -z "$code" || "$code" == \#* ]] && continue
    
    # Process country in background
    process_country "$code" "$name" "$SCRAPER_DIR/providers/onlineradiobox/onlineradiobox.sh" &
    
    ((count++))
    if [ $count -ge "$MAX_JOBS" ]; then
        wait -n # Wait for any one job to finish
        ((count--))
    fi
done < "$COUNTRIES_FILE"

# Wait for remaining jobs
wait

echo -e "${CYAN}==================================================${NC}"
echo -e "${GREEN}All countries processed.${NC}"
echo -e "${CYAN}==================================================${NC}"
