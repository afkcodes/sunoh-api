#!/bin/bash

# Modular Station Counter
# Counts stations across all provider data directories

SCRAPER_ROOT=$(cd "$(dirname "$0")/.." && pwd)
CORE_DIR="$SCRAPER_ROOT/core"
COUNTRIES_FILE="$CORE_DIR/countries.txt"

# Colors
CYAN='\033[1;36m'
GREEN='\033[1;32m'
YELLOW='\033[1;33m'
WHITE='\033[1;37m'
GRAY='\033[0;90m'
NC='\033[0m'

echo -e "${CYAN}==================================================${NC}"
echo -e "${WHITE}           Radio Station Scrape Summary           ${NC}"
echo -e "${CYAN}==================================================${NC}"

printf "${WHITE}%-25s | %-15s | %-10s${NC}\n" "Country" "OnlineRadioBox" "MyTuner"
echo -e "${GRAY}--------------------------+-----------------+------------${NC}"

TOTAL_ORB=0
TOTAL_MYTUNER=0
TOTAL_COUNTRIES=0

# Use the countries file as the master list
while IFS=: read -r code name; do
    [[ -z "$code" || "$code" == \#* ]] && continue
    ((TOTAL_COUNTRIES++))

    # Filenames are uppercase ISO codes
    ISO=${code^^}
    
    orb_file="$SCRAPER_ROOT/providers/onlineradiobox/data/$ISO.json"
    myt_file="$SCRAPER_ROOT/providers/mytuner/data/$ISO.json"
    
    orb_count=0
    myt_count=0
    
    if [[ -f "$orb_file" ]]; then
        orb_count=$(jq '. | length' "$orb_file" 2>/dev/null || echo 0)
    fi
    
    if [[ -f "$myt_file" ]]; then
        myt_count=$(jq '. | length' "$myt_file" 2>/dev/null || echo 0)
    fi
    
    TOTAL_ORB=$((TOTAL_ORB + orb_count))
    TOTAL_MYTUNER=$((TOTAL_MYTUNER + myt_count))
    
    # Print row if there is data
    if [[ $orb_count -gt 0 || $myt_count -gt 0 ]]; then
        printf "%-25s | ${GREEN}%-15s${NC} | ${YELLOW}%-10s${NC}\n" \
            "$name" "$orb_count" "$myt_count"
    fi
done < "$COUNTRIES_FILE"

echo -e "${GRAY}--------------------------+-----------------+------------${NC}"
printf "${WHITE}%-25s | ${GREEN}%-15s${NC} | ${YELLOW}%-10s${NC}\n" \
    "TOTALS ($TOTAL_COUNTRIES countries)" "$TOTAL_ORB" "$TOTAL_MYTUNER"
echo -e "${CYAN}==================================================${NC}"

GRAND_TOTAL=$((TOTAL_ORB + TOTAL_MYTUNER))
echo -e "${WHITE}GRAND TOTAL STATIONS: ${GREEN}$GRAND_TOTAL${NC}"
echo -e "${CYAN}==================================================${NC}"
