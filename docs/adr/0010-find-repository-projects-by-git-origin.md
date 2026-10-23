# Find repository projects by git origin

Issue #180 removed the checkout path from config.json so a teammate can clone each repository anywhere. The board now finds an issue's repository project by reading T3's projects and picking the one whose folder is a main checkout with that repository as its git origin. It still only reads T3 and never registers a project. This supersedes ADR 0009's required checkout path; the rest of 0009 stands.
