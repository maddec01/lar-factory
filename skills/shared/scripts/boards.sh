# shellcheck shell=bash
# Sourced by status.sh and slice.sh: ask_boards_to_read <work ID> asks each running
# local board to read now, so a change to that work record shows before the board's
# next timed read. It asks the board on LAR_BOARD_PORT when that is
# set, else every board recorded in the boards folder of the board's data folder:
# LAR_FACTORY_DATA_DIR when it names an absolute folder, else
# ~/Library/Application Support/Lar Factory.
# The boards' answers, or no board at all, change nothing.

read_board() {
    curl --silent --output /dev/null --max-time 1 --request POST --header 'Content-Type: application/json' \
        --header "Origin: http://127.0.0.1:$1" --data "$(jq -cn --arg id "$2" '{workId: $id}')" \
        "http://127.0.0.1:$1/api/read" || true
}

ask_boards_to_read() {
    local record pid port data_dir="$HOME/Library/Application Support/Lar Factory"
    [[ ${LAR_FACTORY_DATA_DIR:-} != /* ]] || data_dir=$LAR_FACTORY_DATA_DIR
    if [[ ${LAR_BOARD_PORT:-} =~ ^[0-9]+$ ]]; then
        read_board "$LAR_BOARD_PORT" "$1"
        return 0
    fi
    # Each live board records its port in <pid>.json. A record whose process is gone,
    # or whose port no longer answers /healthz, is left over from a board that died.
    for record in "$data_dir/boards/"*.json; do
        [[ -f $record ]] || continue
        pid=$(basename "$record" .json)
        port=$(jq -r '.port' "$record" 2>/dev/null || true)
        [[ $pid =~ ^[0-9]+$ && $port =~ ^[0-9]+$ ]] || continue
        kill -0 "$pid" 2>/dev/null || continue
        if curl --silent --fail --output /dev/null --max-time 1 "http://127.0.0.1:$port/healthz"; then
            read_board "$port" "$1"
        fi
    done
    return 0
}
