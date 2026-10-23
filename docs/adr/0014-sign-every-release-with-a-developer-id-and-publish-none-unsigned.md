# Sign every Release with a Developer ID and publish none unsigned

Settled in [issue #205](https://github.com/maddec01/mux-factory/issues/205).

Squirrel.Mac, which electron-updater uses on macOS, installs an update only if it meets the running app's designated requirement. For an ad-hoc signature that requirement is the build's own code hash, so an unsigned or ad-hoc board app can never update itself. We sign and notarize every Release with Pedro's individual Developer ID. When the signing secrets are missing, the release job fails instead of publishing an unsigned build.

## Considered options

Ad-hoc signing with manual re-downloads was rejected. Every install and update would need Open Anyway in System Settings, and we would have to write our own updater instead of copying T3 Code's.

## Consequences

Moving to another Apple team later, such as an organization enrollment, breaks updates for every installed copy.
