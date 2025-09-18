#!/bin/bash

# Health check script for anonamebot
# This script can be used for external monitoring

set -e

# Configuration
HEALTH_URL="${HEALTH_URL:-http://localhost:8080/healthz}"
TIMEOUT="${TIMEOUT:-10}"
MAX_RETRIES="${MAX_RETRIES:-3}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING:${NC} $1"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR:${NC} $1"
}

# Function to check health endpoint
check_health() {
    local retries=0
    
    while [ $retries -lt $MAX_RETRIES ]; do
        if curl -f -s --max-time $TIMEOUT "$HEALTH_URL" > /dev/null 2>&1; then
            log "Health check passed"
            return 0
        else
            retries=$((retries + 1))
            if [ $retries -lt $MAX_RETRIES ]; then
                warn "Health check failed (attempt $retries/$MAX_RETRIES), retrying in 5 seconds..."
                sleep 5
            fi
        fi
    done
    
    error "Health check failed after $MAX_RETRIES attempts"
    return 1
}

# Function to check Docker container status
check_container() {
    if command -v docker > /dev/null 2>&1; then
        if docker ps --filter "name=anonamebot" --filter "status=running" | grep -q anonamebot; then
            log "Docker container is running"
            return 0
        else
            error "Docker container is not running"
            return 1
        fi
    else
        warn "Docker not available, skipping container check"
        return 0
    fi
}

# Function to check disk space
check_disk_space() {
    local threshold=90
    local usage=$(df / | awk 'NR==2 {print $5}' | sed 's/%//')
    
    if [ "$usage" -gt "$threshold" ]; then
        error "Disk usage is ${usage}%, above threshold of ${threshold}%"
        return 1
    else
        log "Disk usage is ${usage}%"
        return 0
    fi
}

# Function to check memory usage
check_memory() {
    if command -v free > /dev/null 2>&1; then
        local mem_usage=$(free | awk 'NR==2{printf "%.0f", $3*100/$2}')
        local threshold=90
        
        if [ "$mem_usage" -gt "$threshold" ]; then
            error "Memory usage is ${mem_usage}%, above threshold of ${threshold}%"
            return 1
        else
            log "Memory usage is ${mem_usage}%"
            return 0
        fi
    else
        warn "Free command not available, skipping memory check"
        return 0
    fi
}

# Main health check function
main() {
    log "Starting health check for anonamebot..."
    
    local exit_code=0
    
    # Run all checks
    check_health || exit_code=1
    check_container || exit_code=1
    check_disk_space || exit_code=1
    check_memory || exit_code=1
    
    if [ $exit_code -eq 0 ]; then
        log "All health checks passed ✅"
    else
        error "Some health checks failed ❌"
    fi
    
    exit $exit_code
}

# Run main function
main "$@"
