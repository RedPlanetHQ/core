#!/bin/bash

echo "================================================================"
echo "  MONEY-MACHINE HEALTH CHECK"
echo "================================================================"
echo ""

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}SYSTEM RESOURCES${NC}"
echo "----------------------------------------------------------------"
RAM_TOTAL=$(free -h | awk '/^Mem:/{print $2}')
RAM_USED=$(free -h | awk '/^Mem:/{print $3}')
RAM_PERCENT=$(free | awk '/^Mem:/{printf("%.1f"), $3/$2*100}')
echo "RAM: $RAM_USED / $RAM_TOTAL ($RAM_PERCENT%)"
DISK=$(df -h / | awk 'NR==2 {print $3 " / " $2 " (" $5 ")"}')
echo "Disk: $DISK"
echo ""

echo -e "${YELLOW}SERVICES${NC}"
echo "----------------------------------------------------------------"
curl -s http://localhost:11434/api/tags > /dev/null 2>&1 && echo -e "Ollama:    ${GREEN}Running${NC}" || echo -e "Ollama:    ${RED}Down${NC}"
curl -s http://localhost:8503 > /dev/null 2>&1 && echo -e "Dashboard: ${GREEN}Running${NC}" || echo -e "Dashboard: ${RED}Down${NC}"
systemctl is-active ollama > /dev/null 2>&1 && echo -e "Ollama SVC: ${GREEN}Active${NC}" || echo -e "Ollama SVC: ${RED}Inactive${NC}"
echo ""

echo -e "${YELLOW}AI MODELS${NC}"
echo "----------------------------------------------------------------"
ollama list 2>/dev/null || echo "Ollama not available"
echo ""

echo "================================================================"
echo "  Health Check Complete"
echo "================================================================"
