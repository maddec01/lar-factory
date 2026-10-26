#!/usr/bin/env bash
# Tests release-secrets.sh with typed answers on stdin and a stubbed gh. No network.
set -euo pipefail

WIZARD="$(cd "$(dirname "$0")" && pwd)/release-secrets.sh"
REPO_PATH=repos/maddec01/lar-factory/environments/release

failures=0
pass() { printf 'ok   %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; failures=$((failures + 1)); }

PASSWORD='p12-pass word'
P8_BODY='-----BEGIN PRIVATE KEY-----p8-secret-body-----END PRIVATE KEY-----'
P12_BODY='p12-secret-bytes'
P12_BASE64=$(printf '%s' "$P12_BODY" | base64 | tr -d '\n')

# A fake gh that logs its arguments and stdin. GH_HAS_ENV and GH_POLICIES describe
# the release environment it reports; GH_ADMIN=false makes the account a non-admin,
# and GH_ADMIN_ERROR makes reading the account's permissions fail with that error.
make_bin() {
  local bin
  bin=$(mktemp -d)
  cat >"$bin/gh" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >>"\$GH_LOG"
case "\$*" in
  "auth status"*) exit 0 ;;
  "api repos/maddec01/lar-factory --jq .permissions.admin")
    [[ -z \${GH_ADMIN_ERROR:-} ]] || { echo "\$GH_ADMIN_ERROR" >&2; exit 1; }
    echo "\${GH_ADMIN:-true}" ;;
  "api $REPO_PATH --jq"*)
    [[ -n \${GH_HAS_ENV:-} ]] || { echo '{"message":"Not Found"}'; echo 'gh: Not Found (HTTP 404)' >&2; exit 1; }
    echo true ;;
  "api $REPO_PATH/deployment-branch-policies --jq"*)
    [[ -n \${GH_HAS_ENV:-} ]] || { echo '{"message":"Not Found"}'; echo 'gh: Not Found (HTTP 404)' >&2; exit 1; }
    printf '%s' "\${GH_POLICIES:-}" ;;
  "secret set"*) cat >>"\$GH_STDIN"; printf '\n' >>"\$GH_STDIN" ;;
esac
EOF
  local opener
  for opener in gh open xdg-open; do
    [[ $opener == gh ]] || printf '#!/usr/bin/env bash\n' >"$bin/$opener"
    chmod +x "$bin/$opener"
  done
  printf '%s' "$bin"
}

# The answers to every prompt, in order. The empty answers and the short Team ID
# test that the wizard asks again; the empty Key ID takes the one in the .p8 name.
ANSWERS=("" "<p12>" "" "$PASSWORD" "<p8>" "" "" issuer-uuid TEAM42 ABCDE12345 y)

# run_wizard [args...] runs the wizard in a fresh empty directory with the files
# the maintainer exported, giving it $ANSWERS with <p12> and <p8> replaced by their paths.
# Sets $output, $status, $dir and $logs.
run_wizard() {
  local bin files
  bin=$(make_bin)
  files=$(mktemp -d)
  dir=$(mktemp -d)
  logs=$(mktemp -d)
  printf '%s' "$P12_BODY" >"$files/lar.p12"
  printf '%s' "$P8_BODY" >"$files/AuthKey_ABC123.p8"
  touch "$logs/args" "$logs/stdin"
  local answers=("${ANSWERS[@]/#<p12>/$files/lar.p12}")
  answers=("${answers[@]/#<p8>/$files/AuthKey_ABC123.p8}")
  status=0
  output=$(cd "$dir" && printf '%s\n' "${answers[@]}" |
    PATH="$bin:$PATH" GH_LOG="$logs/args" GH_STDIN="$logs/stdin" bash "$WIZARD" "$@" 2>&1) || status=$?
}

check() {
  if [[ $2 == *"$3"* ]]; then pass "$1"; else fail "$1: no '$3' in: $2"; fi
}
check_not() {
  if [[ $2 == *"$3"* ]]; then fail "$1: found '$3' in: $2"; else pass "$1"; fi
}
# check_status "name" EXPECTED compares the last run's exit status exactly.
check_status() {
  if [[ $status == "$2" ]]; then pass "$1"; else fail "$1: exit status $status, not $2"; fi
}

run_wizard --dry-run
check "dry run prints the environment it would create" "$output" \
  "gh api --method PUT $REPO_PATH -F deployment_branch_policy[protected_branches]=false -F deployment_branch_policy[custom_branch_policies]=true"
check "dry run prints the main-only branch policy" "$output" \
  "gh api --method POST $REPO_PATH/deployment-branch-policies -f name=main -f type=branch"
for name in CSC_LINK CSC_KEY_PASSWORD APPLE_API_KEY APPLE_API_KEY_ID APPLE_API_ISSUER; do
  check "dry run prints the $name secret" "$output" \
    "gh secret set $name --env release --repo maddec01/lar-factory"
done
check "dry run prints the team ID variable" "$output" \
  "gh variable set APPLE_TEAM_ID --env release --repo maddec01/lar-factory --body ABCDE12345"
check "asks again after an empty answer" "$output" "This can't be empty."
check "asks again after a Team ID that is not 10 uppercase letters and digits" "$output" \
  "A Team ID is 10 uppercase letters and digits."
check "says setup is complete after storing the secrets" "$output" "Setup complete"
for secret in "$PASSWORD" "$P8_BODY" "$P12_BASE64" "$P12_BODY" issuer-uuid; do
  check_not "dry run never prints a secret" "$output" "$secret"
done
args=$(cat "$logs/args")
check_not "dry run creates no environment" "$args" "--method"
check_not "dry run sets no secret" "$args" "secret set"
check_not "dry run sets no variable" "$args" "variable set"
check_not "a missing environment has no other branch policies" "$output" "also allows"
check_not "dry run reports no change as made" "$output" "✓ branch policy"

GH_HAS_ENV=1 GH_POLICIES=main run_wizard --dry-run
check "re-run skips an environment that limits branches" "$output" "already limited to chosen branches"
check "re-run skips an existing main policy" "$output" "already allows main"
check_not "re-run creates no environment" "$output" "--method PUT"
check_not "re-run adds no branch policy" "$output" "--method POST"

GH_HAS_ENV=1 GH_POLICIES=$'main\nrelease/*' run_wizard --dry-run
check "warns about branch policies other than main" "$output" "release/*"

run_wizard
args=$(cat "$logs/args")
stdin=$(cat "$logs/stdin")
check "a real run creates the environment" "$args" "api --method PUT $REPO_PATH"
check "a real run adds the branch policy" "$args" "api --method POST $REPO_PATH/deployment-branch-policies"
check "a real run sets the team ID variable" "$args" "variable set APPLE_TEAM_ID --env release"
check "CSC_LINK is the .p12 in base64" "$stdin" "$P12_BASE64"
check "CSC_KEY_PASSWORD is the password" "$stdin" "$PASSWORD"
check "APPLE_API_KEY is the .p8 contents" "$stdin" "$P8_BODY"
check "APPLE_API_ISSUER is the issuer ID" "$stdin" "issuer-uuid"
check "APPLE_API_KEY_ID defaults to the ID in the .p8 name" "$stdin" "$P8_BODY"$'\nABC123\n'
for secret in "$PASSWORD" "$P8_BODY" "$P12_BASE64" issuer-uuid; do
  check_not "secrets go to gh on stdin, not as arguments" "$args" "$secret"
  check_not "a real run never prints a secret" "$output" "$secret"
done
if [[ -z $(ls -A "$dir") ]]; then
  pass "writes no file"
else
  fail "writes no file: $(ls -A "$dir")"
fi

GH_ADMIN=false run_wizard
check_status "stops when the gh account is not an admin" 1
check "names the admin requirement" "$output" "isn't an admin of maddec01/lar-factory"
check_not "stops before the Apple stages" "$output" "Stage 1"

GH_ADMIN=false run_wizard --dry-run
check_status "a dry run goes on when the gh account is not an admin" 0
check "a dry run warns that the account is not an admin" "$output" \
  "isn't an admin of maddec01/lar-factory, so a real run would stop here"
check "a dry run as a non-admin reaches the Apple stages" "$output" "Stage 1"

GH_ADMIN_ERROR='gh: HTTP 403: Resource protected by organization SAML enforcement' run_wizard --dry-run
check_status "stops when gh can't read the permissions" 1
check "shows gh's error when it can't read the permissions" "$output" \
  "couldn't read maddec01/lar-factory's permissions: gh: HTTP 403: Resource protected by organization SAML enforcement"
check_not "a failed permissions read is not called a non-admin" "$output" "isn't an admin"
check_not "a failed permissions read stops before the Apple stages" "$output" "Stage 1"

ANSWERS=("${ANSWERS[@]:0:${#ANSWERS[@]}-1}" n)
run_wizard
args=$(cat "$logs/args")
check_not "declining stores no secret" "$args" "secret set"
check_not "declining does not say setup is complete" "$output" "Setup complete"
check "declining says the secrets weren't stored" "$output" "weren't stored. Run bash scripts/release-secrets.sh again"
check_not "declining with only main allowed adds no branch warning" "${output#*"weren't stored"}" "also allows"

GH_HAS_ENV=1 GH_POLICIES=$'main\nrelease/*' run_wizard
check "declining shows the other branch policies again on the closing screen" \
  "${output#*"weren't stored"}" "also allows: release/*"

if ((failures)); then
  printf '%s failed\n' "$failures"
  exit 1
fi
printf 'all passed\n'
