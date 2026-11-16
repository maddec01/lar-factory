# Threads read skills from app-managed release folders

The app used to install factory skills into `~/.agents/skills` and other agent profiles, which needed install targets, Drift handling and Replace, and an app update could change a run's instructions while the run was working. Now the app copies each release's skills into a release folder in its data folder, passes threads absolute paths to the release their run froze, and installs nothing into agent profiles. Runs keep the instructions they started with across app updates, and the app keeps no install state. In exchange, agents outside a factory thread can no longer find the lar skills by name.

Origin: maddec01/lar-factory#999.
