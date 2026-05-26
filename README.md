# Facebook CLI with a Twist

A stealthy Chrome/Edge extension that transforms your Facebook feed into a retro command-line interface (CLI) directly in your browser. 
Perfect for browsing Facebook discreetly while looking like you're deep in the terminal compiling code!

## Features
- **Total Stealth:** Completely hides the original Facebook UI (no images, no videos, no colorful buttons).
- **Retro Aesthetic:** Renders posts as terminal commands (`Author@fb:~$`) on a classic black screen with green/white text.
- **Auto-expanding Posts:** Automatically clicks "See more" in the background and seamlessly updates the terminal with the full text.
- **Terminal Pacing:** Queues up incoming posts and prints them one by one to perfectly simulate terminal output.
- **Smart Scroll:** Locks your scroll position when reading past logs, and only proxies your downward scrolls to Facebook's hidden feed to keep new content loading.
- **Localization Support:** Automatically detects and filters out localized UI buttons (like `Thích`, `Bình luận`, etc.) and seamlessly triggers the Vietnamese `Xem thêm` button.

## Installation
1. Clone this repository or download the source code folder.
2. Open Chrome or Edge and navigate to the Extensions page (`chrome://extensions/` or `edge://extensions/`).
3. Enable **Developer Mode** in the top right corner.
4. Click **Load unpacked** and select the folder containing these extension files.
5. Open Facebook.com and enjoy your new terminal!
