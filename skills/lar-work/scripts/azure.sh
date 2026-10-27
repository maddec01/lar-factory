# shellcheck shell=bash disable=SC2034 # the variables each parser sets are for the scripts that source this
# Sourced by the lar-work scripts that reach Azure DevOps through az.
# Each parser sets az_org (https://dev.azure.com/<org>), az_project (as in the
# URL, which may be percent-encoded) and returns false when its argument isn't
# of its form.

# azure_repo <origin URL | org/project/repo>: also sets az_repo. Takes the three
# origin forms: https://[user@]dev.azure.com/<org>/<project>/_git/<repo>,
# git@ssh.dev.azure.com:v3/<org>/<project>/<repo> and
# https://<org>.visualstudio.com/<project>/_git/<repo>.
azure_repo() {
    local part='[A-Za-z0-9._%~-]+'
    if [[ $1 =~ ^https://([^@/]+@)?dev\.azure\.com/($part)/($part)/_git/($part)/?$ ]]; then
        az_org=https://dev.azure.com/${BASH_REMATCH[2]} az_project=${BASH_REMATCH[3]} az_repo=${BASH_REMATCH[4]}
    elif [[ $1 =~ ^git@ssh\.dev\.azure\.com:v3/($part)/($part)/($part)$ ||
        $1 =~ ^($part)/($part)/($part)$ ]]; then
        az_org=https://dev.azure.com/${BASH_REMATCH[1]} az_project=${BASH_REMATCH[2]} az_repo=${BASH_REMATCH[3]}
    elif [[ $1 =~ ^https://([^@/]+@)?([A-Za-z0-9-]+)\.visualstudio\.com/($part)/_git/($part)/?$ ]]; then
        az_org=https://dev.azure.com/${BASH_REMATCH[2]} az_project=${BASH_REMATCH[3]} az_repo=${BASH_REMATCH[4]}
    else
        return 1
    fi
    # "." and ".." are no names, and stay out of the request paths.
    [[ ! ${az_org##*/} =~ ^\.\.?$ ]] && azure_name_ok "$az_project" && azure_name_ok "$az_repo"
}

# azure_work_item <URL>: also sets az_id. Takes
# https://dev.azure.com/<org>/<project>/_workitems/edit/<id> and the same on
# https://<org>.visualstudio.com.
azure_work_item() {
    if [[ $1 =~ ^https://dev\.azure\.com/([A-Za-z0-9._-]+)/([^/?#]+)/_workitems/edit/([0-9]+)/?$ ]]; then
        az_org=https://dev.azure.com/${BASH_REMATCH[1]} az_project=${BASH_REMATCH[2]} az_id=${BASH_REMATCH[3]}
    elif [[ $1 =~ ^https://([A-Za-z0-9-]+)\.visualstudio\.com/([^/?#]+)/_workitems/edit/([0-9]+)/?$ ]]; then
        az_org=https://dev.azure.com/${BASH_REMATCH[1]} az_project=${BASH_REMATCH[2]} az_id=${BASH_REMATCH[3]}
    else
        return 1
    fi
    azure_name_ok "$az_project"
}

# azure_name_ok <name>: whether the name, decoded, is one part of a request path:
# it holds no / or \, and isn't "." or "..".
azure_name_ok() {
    local name
    name=$(percent_decode "$1")
    [[ $name != */* && $name != *\\* && ! $name =~ ^\.\.?$ ]]
}

# percent_decode <text>: the text with each %XX turned back into its byte, as az takes names.
percent_decode() {
    local text=${1//\\/\\\\}
    printf '%b' "${text//%/\\x}"
}

# az_failure <what failed> <az's stderr>: prints why az failed and the fix, on one line.
az_failure() {
    if [[ $2 == *"misspelled or not recognized"* ]]; then
        echo "az has no azure-devops extension. Run az extension add --name azure-devops, then rerun."
    elif [[ $2 == *"az login"* ]]; then
        echo "az is logged out. Run az login, then rerun."
    else
        echo "$1. $2"
    fi
}
