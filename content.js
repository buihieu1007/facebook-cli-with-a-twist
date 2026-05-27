// content.js

let cliOverlay = null;
const processedPosts = new Map();
const printQueue = [];

// Clean all Facebook text obfuscation (zero-width spaces, direction marks, soft hyphens, etc.)
function cleanObfuscatedText(str) {
    if (!str) return "";
    return str.replace(/[\u200B-\u200D\uFEFF\u200E\u200F\u00AD]/g, "").replace(/\s+/g, " ").trim();
}

// Process the print queue so posts appear one by one
setInterval(() => {
    if (printQueue.length > 0) {
        const renderTask = printQueue.shift();
        renderTask();
    }
}, 600); // Wait 600ms between rendering each post

function initOverlay() {
    if (document.getElementById('fb-cli-overlay')) return;

    cliOverlay = document.createElement('div');
    cliOverlay.id = 'fb-cli-overlay';
    cliOverlay.innerHTML = `<div class="fb-cli-post"><span style="color:#fff;font-weight:bold;">fb-cli v1.0</span><br/>Initializing connection to mainframe...</div>`;
    
    // Inject dynamic overlay styles to ensure layout is correct
    Object.assign(cliOverlay.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        width: '100vw',
        height: '100vh',
        overflowY: 'scroll',
        zIndex: '2147483647', // Maximum possible z-index to defeat Facebook's popups
        pointerEvents: 'auto' // We handle scroll proxying via JS now
    });

    document.documentElement.appendChild(cliOverlay);

    // Proxy scroll events to the main window to trigger Facebook's infinite scroll
    cliOverlay.addEventListener('wheel', (e) => {
        // Only proxy downward scrolls to Facebook.
        // This lets the user scroll up in the CLI without messing up Facebook's forward feed loading.
        if (e.deltaY > 0) {
            window.scrollBy({
                top: e.deltaY,
                behavior: 'auto'
            });
        }
    }, { passive: true });
}

// 2. Function to extract data
function extractPostData(postElement) {
    let authorParts = [];
    const ignoreAuthors = ['follow', 'theo dõi', 'join', 'tham gia', 'like', 'thích', 'comment', 'bình luận', 'share', 'chia sẻ', 'chỉ báo trạng thái', 'đang hoạt động', 'online status', 'active now'];
    
    // Robust selector for authors and groups
    const potentialAuthors = postElement.querySelectorAll('h2, h3, h4, strong, b, a[role="link"]');
    for (let el of potentialAuthors) {
        let text = cleanObfuscatedText(el.textContent);
        let lower = text.toLowerCase();
        
        // Strip out any bullet points or extra punctuation from the text
        let cleanText = text.replace(/^·\s*/, '').trim();
        
        if (cleanText && cleanText.length > 0 && cleanText.length < 50) {
            // Check if any of the ignore words are INSIDE the text
            let shouldIgnore = ignoreAuthors.some(ignore => lower.includes(ignore));
            
            if (!shouldIgnore) {
                if (!authorParts.includes(cleanText)) {
                    authorParts.push(cleanText);
                }
            }
        }
        if (authorParts.length >= 2) break; // We only need the top 2 (Group and Author)
    }
    
    // Build the Windows path string
    let pathString = "Unknown_User";
    if (authorParts.length > 0) {
        pathString = authorParts.map(p => p.replace(/\s+/g, '_')).join('\\');
    }
    
    let author = authorParts.length > 0 ? authorParts[authorParts.length - 1] : "Unknown User";

    let postBody = "";
    // Robust selector for text blocks
    const textDivs = postElement.querySelectorAll('div[dir="auto"], span[dir="auto"], div[data-ad-preview="message"]');
    const ignoreList = ['Like', 'Comment', 'Share', 'Send', 'Thích', 'Bình luận', 'Chia sẻ', 'Gửi'];
    for (let div of textDivs) {
        let text = cleanObfuscatedText(div.textContent);
        if (text.length > 15 && text !== author && !ignoreList.includes(text)) {
            if (text.length > postBody.length) {
                postBody = text;
            }
        }
    }

    // Skip Reels, Stories, or other non-user feed blocks
    if (author.toLowerCase() === 'reels' || author.toLowerCase() === 'stories') {
        return null;
    }
    
    // Skip if the body is just an ARIA label spam (like "FacebookFacebookFacebook")
    if (postBody.replace(/Facebook|Reels/gi, '').trim().length < 10) {
        return null;
    }

    // Detect and completely ignore posts that lack real text and only contain Facebook's obfuscated tracking strings.
    const spaceCount = (postBody.match(/\s/g) || []).length;
    if (postBody.length > 30 && spaceCount < 3) {
        return null; // This post is likely an image/video ad with no real caption
    }

    // Clean up trailing 'Xem thêm' or 'See more' that might have snuck in (including unicode ellipsis '…')
    postBody = postBody.replace(/…?\s*Xem thêm$/i, '')
                       .replace(/\.\.\.\s*Xem thêm$/i, '')
                       .replace(/…?\s*See more$/i, '')
                       .replace(/\.\.\.\s*See more$/i, '')
                       .replace(/…$/, '')
                       .replace(/\.\.\.$/, '')
                       .trim();

    // Extract comment count
    let commentCount = "";
    const allDescendants = postElement.getElementsByTagName('*');

    // Strategy 1: Check text content of all descendants (deepest/smallest first, or any with length < 100)
    for (let el of allDescendants) {
        if (el.textContent && el.textContent.length < 100) {
            let text = cleanObfuscatedText(el.textContent);
            let match = text.match(/(\d+[\dKkMm,.]*)\s*(?:bình luận|comments?)/i);
            if (match) {
                commentCount = match[1];
                break;
            }
        }
    }

    // Strategy 2: Check aria-labels of all descendants
    if (!commentCount) {
        for (let el of allDescendants) {
            let ariaLabel = el.getAttribute('aria-label');
            if (ariaLabel) {
                let cleanAria = cleanObfuscatedText(ariaLabel);
                let match = cleanAria.match(/(\d+[\dKkMm,.]*)\s*(?:bình luận|comments?)/i);
                if (match) {
                    commentCount = match[1];
                    break;
                }
            }
        }
    }

    // Strategy 3: Sibling/Parent text search near comment buttons
    if (!commentCount) {
        const commentBtns = postElement.querySelectorAll('[aria-label*="Comment" i], [aria-label*="Bình luận" i]');
        for (let btn of commentBtns) {
            let parent = btn.parentElement;
            for (let i = 0; i < 4 && parent; i++) {
                const possibleNumbers = parent.querySelectorAll('span, div');
                for (let numEl of possibleNumbers) {
                    if (numEl.children.length === 0) {
                        let numText = cleanObfuscatedText(numEl.textContent);
                        if (/^\d+[\dKkMm,.]*$/.test(numText) && !/[hdmys]/i.test(numText)) {
                            commentCount = numText;
                            break;
                        }
                    }
                }
                if (commentCount) break;
                parent = parent.parentElement;
            }
            if (commentCount) break;
        }
    }

    // Extract reaction/like count
    let likeCount = "0";
    for (let el of allDescendants) {
        let ariaLabel = el.getAttribute('aria-label');
        if (ariaLabel) {
            let cleanAria = cleanObfuscatedText(ariaLabel);
            let match = cleanAria.match(/(\d+[\dKkMm,.]*)\s*(?:others|người khác|reactions?|cảm xúc|thích|likes?)/i);
            if (match) {
                likeCount = match[1];
                break;
            }
        }
    }
    
    if (likeCount === "0") {
        const icons = postElement.querySelectorAll('[role="img"]');
        for (let icon of icons) {
            let parent = icon.parentElement;
            for (let i = 0; i < 4 && parent; i++) {
                let pText = cleanObfuscatedText(parent.textContent);
                let match = pText.match(/^(\d+[\dKkMm,.]*)$/);
                if (match) {
                    likeCount = match[1];
                    break;
                }
                parent = parent.parentElement;
            }
            if (likeCount !== "0") break;
        }
    }

    // Return pathString as 'author' so the rest of the CLI uses it natively
    return { author: pathString, body: postBody, commentCount, likeCount };
}

// 3. Render a post
function renderPost(postData, postNode, uniqueId) {
    if (!cliOverlay) return null;
    
    const postDiv = document.createElement('div');
    postDiv.className = 'fb-cli-post';
    
    const likes = postData.likeCount || "0";
    const comments = postData.commentCount || "0";
    
    postDiv.innerHTML = `<div class="fb-cli-text"><span class="prompt">C:\\Users\\${escapeHtml(postData.author)}&gt;</span> <span class="fb-cli-body">${escapeHtml(postData.body)}</span> <span class="fb-cli-load-comments" data-id="${uniqueId}">[ L: ${escapeHtml(likes)} | C: ${escapeHtml(comments)} ]</span></div><div class="fb-cli-comments-container"></div>`;
    cliOverlay.appendChild(postDiv);
    
    // Add event listener for the load comments button
    const loadBtn = postDiv.querySelector('.fb-cli-load-comments');
    if (loadBtn && postNode) {
        loadBtn.addEventListener('click', () => {
            triggerLoadComments(postNode, postDiv);
        });
    }
    
    return postDiv;
}

function updatePost(postDiv, postData) {
    const bodySpan = postDiv.querySelector('.fb-cli-body');
    if (bodySpan) {
        bodySpan.innerHTML = escapeHtml(postData.body);
    }
}

function escapeHtml(unsafe) {
    if (!unsafe) return "";
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

// Handle an individual post node
function processPost(postNode) {
    // Intercept comments that Facebook renders as full articles (e.g. on permalink pages or inline)
    let nodeLabel = (postNode.getAttribute('aria-label') || '').toLowerCase();
    if (nodeLabel.includes('comment') || nodeLabel.includes('bình luận')) {
        if (window.currentActiveCommentContainer) {
            let author = cleanCommentAuthor(postNode.getAttribute('aria-label'));
            let body = "";
            const textDivs = postNode.querySelectorAll('div[dir="auto"]');
            for (let div of textDivs) {
                let text = cleanObfuscatedText(div.textContent);
                if (text.length > 0 && text !== author && !text.includes(author)) {
                    if (text.length > body.length) body = text;
                }
            }
            if (body.length > 0) {
                const commentId = `comment-${author}-${body.substring(0, 15)}`.replace(/\s/g, '');
                if (!window.currentActiveCommentContainer.querySelector(`[data-comment-id="${commentId}"]`)) {
                    const commentEl = document.createElement('div');
                    commentEl.className = 'fb-cli-comment';
                    commentEl.setAttribute('data-comment-id', commentId);
                    commentEl.innerHTML = `<span class="fb-cli-comment-author">${escapeHtml(author)}:</span> ${escapeHtml(body)}`;
                    window.currentActiveCommentContainer.appendChild(commentEl);
                }
                if (window.currentActiveLoadBtn) window.currentActiveLoadBtn.style.display = 'none';
            }
        }
        return; // Always prevent comments from being rendered as main feed posts
    }

    // We use a TreeWalker to find the exact text node, because Facebook's HTML tags are highly unpredictable.
    const walker = document.createTreeWalker(postNode, NodeFilter.SHOW_TEXT, null, false);
    let textNode;
    let clickedSeeMore = false;
    while (textNode = walker.nextNode()) {
        let t = textNode.nodeValue.trim().toLowerCase();
        if (t === 'see more' || t === 'xem thêm' || t === '… see more' || t === '… xem thêm' || t === '... see more' || t === '... xem thêm' || t === 'continue reading') {
            let clickable = textNode.parentElement;
            // Click the element and bubble up a few layers to ensure we hit the one with the React onClick handler
            for (let i = 0; i < 3 && clickable; i++) {
                if (clickable.click) clickable.click();
                clickable = clickable.parentElement;
            }
            clickedSeeMore = true;
        }
    }

    const processExtractedData = () => {
        const postData = extractPostData(postNode);
        if (postData && postData.body && postData.body.length > 20) {
            // Create unique ID based on author and a small snippet of the text (20 chars) to ensure it stays stable
            const snippet = postData.body.substring(0, 20).replace(/\s/g, '');
            const uniqueId = `${postData.author}_${snippet}`;
            
            if (!processedPosts.has(uniqueId)) {
                // Mark it as processed immediately to prevent duplicates entering the queue
                processedPosts.set(uniqueId, { length: postData.body.length, element: null });
                
                // Add to the slow-print queue
                printQueue.push(() => {
                    const postDiv = renderPost(postData, postNode, uniqueId);
                    // Save the actual DOM element so it can be updated if "See more" triggers
                    const existing = processedPosts.get(uniqueId);
                    if (existing) {
                        existing.element = postDiv;
                    }
                });
            } else {
                // It's already in the CLI! But did the text expand because we clicked "See more"?
                const existingData = processedPosts.get(uniqueId);
                if (postData.body.length > existingData.length) {
                    if (existingData.element) {
                        updatePost(existingData.element, postData);
                    }
                    existingData.length = postData.body.length;
                }
            }
        }
    };

    if (clickedSeeMore) {
        setTimeout(processExtractedData, 500);
    } else {
        processExtractedData();
    }
}

function scanExistingPosts() {
    const selectors = ['div[role="article"]', 'div[data-pagelet^="FeedUnit"]', 'div[aria-posinset]'];
    selectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(processPost);
    });
}

// 4. Mutation Observer for Instant Detection
function startObserver() {
    scanExistingPosts();
    
    const observer = new MutationObserver((mutations) => {
        for (let mutation of mutations) {
            if (mutation.addedNodes.length) {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === 1) { // Element Node
                        // Check if the added node itself is a post
                        const isPost = node.matches && (node.matches('div[role="article"]') || node.matches('div[data-pagelet^="FeedUnit"]') || node.matches('div[aria-posinset]'));
                        if (isPost) {
                            processPost(node);
                        } else if (node.querySelectorAll) {
                            // Check if the added node contains posts
                            const posts = node.querySelectorAll('div[role="article"], div[data-pagelet^="FeedUnit"], div[aria-posinset]');
                            posts.forEach(processPost);
                        }
                    }
                });
            }
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });
}

// --- COMMENT AND NAVIGATION HANDLING LOGIC ---

function cleanCommentAuthor(label) {
    if (!label) return "Unknown";
    let cleaned = cleanObfuscatedText(label);
    return cleaned
        // Remove prefixes
        .replace(/^(?:Comment by|Bình luận của|Bình luận dưới tên|Commented by)\s+/i, '')
        // Remove suffixes (timestamps like "vào 1 giờ trước", "vào khoảng 1 giờ trước", "about an hour ago", "lúc...", ", 1d", etc.)
        .replace(/\s+(?:vào|vào khoảng|about|at|lúc|,).*/i, '')
        .replace(/:$/, '')
        .trim() || "Unknown";
}

function findCommentButton(postNode) {
    const candidates = postNode.querySelectorAll('div[role="button"], a, div[clickable="true"], [aria-label]');
    
    // Exact button match
    for (let el of candidates) {
        let label = (el.getAttribute('aria-label') || '').toLowerCase();
        let text = cleanObfuscatedText(el.textContent).toLowerCase();
        
        if (label === 'bình luận' || label === 'comment' || 
            label.startsWith('viết bình luận') || label.startsWith('write a comment') ||
            label.includes('leave a comment')) {
            return el;
        }
        
        if (text === 'bình luận' || text === 'comment') {
            return el;
        }
    }
    
    // Partial match
    for (let el of candidates) {
        let label = (el.getAttribute('aria-label') || '').toLowerCase();
        if (label.includes('bình luận') || label.includes('comment')) {
            if (!/(\d+[\dKkMm,.]*)\s*(?:bình luận|comments?)/i.test(label)) {
                return el;
            }
        }
    }
    
    // Text fallback
    for (let el of candidates) {
        let text = cleanObfuscatedText(el.textContent).toLowerCase();
        if (text === 'bình luận' || text === 'comment') {
            return el;
        }
    }
    
    return null;
}

function closeCommentOverlay(originalUrl) {
    // 1. Dispatch Escape key event (safest top-level closer)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
    
    // 2. Click ONLY the first visible close button (staggered slightly to avoid event collision)
    setTimeout(() => {
        if (window.location.href !== originalUrl) {
            const closeBtns = document.querySelectorAll('[aria-label*="Close" i], [aria-label*="Đóng" i]');
            for (let btn of closeBtns) {
                // Check if button is actually rendered/visible
                if (btn.offsetWidth > 0 || btn.offsetHeight > 0) {
                    if (btn.click) {
                        btn.click();
                        break; // Click ONLY ONE button!
                    }
                }
            }
        }
    }, 150);
    
    // 3. Safe double-navigation prevention watcher:
    // Only fire window.history.back() if the native Escape or Close clicks failed to restore the URL.
    let checkAttempts = 0;
    const urlChecker = setInterval(() => {
        checkAttempts++;
        if (window.location.href === originalUrl) {
            clearInterval(urlChecker); // Successfully went back natively! Clear immediately.
        } else if (checkAttempts >= 10) { // Failed natively after 2 seconds
            clearInterval(urlChecker);
            window.history.back(); // Fire browser-history back only as final fallback
        }
    }, 200);
}

function triggerLoadComments(postNode, postDiv) {
    const loadBtn = postDiv.querySelector('.fb-cli-load-comments');
    
    const commentBtn = findCommentButton(postNode);
    if (!commentBtn) {
        if (loadBtn) loadBtn.textContent = '[ no inline comment button found ]';
        return;
    }
    
    // Set active comment container so processPost will intercept them as they load
    window.currentActiveCommentContainer = postDiv.querySelector('.fb-cli-comments-container');
    window.currentActiveLoadBtn = loadBtn;
    const originalUrl = window.location.href;
    
    if (loadBtn) loadBtn.textContent = '[ loading... ]';
    
    // Click the native comment button
    let clickable = commentBtn;
    for (let i = 0; i < 4 && clickable; i++) {
        if (clickable.click) clickable.click();
        clickable = clickable.parentElement;
    }
    
    // Watch for URL/view transitions to trigger auto-return
    let watcherAttempts = 0;
    const watcher = setInterval(() => {
        watcherAttempts++;
        
        if (window.location.href !== originalUrl) {
            clearInterval(watcher);
            // Give Facebook 2.5 seconds to populate comments on the new overlay/view
            setTimeout(() => {
                closeCommentOverlay(originalUrl);
            }, 2500);
        } else if (watcherAttempts > 40) { // Timeout after 8 seconds (e.g. if comments loaded inline without URL change)
            clearInterval(watcher);
        }
    }, 200);
}

// Start listeners
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initOverlay();
        startObserver();
    });
} else {
    initOverlay();
    startObserver();
}
