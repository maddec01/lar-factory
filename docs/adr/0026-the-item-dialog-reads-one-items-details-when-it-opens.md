# The item dialog reads one item's details when it opens

The board-wide read leaves out descriptions and comments, and the item dialog fetches them for one item when the user opens it. Adding them to the board-wide read would spend GitHub's rate limit on every refresh for text the user reads for one item at a time, and the board already uses much of that limit. For the same reason, images in a description or comment show as links rather than loading through the board server with the user's login.
