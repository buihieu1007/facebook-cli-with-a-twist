// content.js

let cliOverlay = null;
const processedPosts = new Map();
const printQueue = [];

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
    let author = "Unknown User";
    
    // Robust selector for authors (h2, h3, h4, strong, or b)
    const potentialAuthors = postElement.querySelectorAll('h2, h3, h4, strong, b, a[role="link"]');
    for (let el of potentialAuthors) {
        let text = el.textContent.trim();
        let lower = text.toLowerCase();
        if (text && text.length > 0 && text.length < 50 && !lower.includes('comment') && !lower.includes('bình luận')) {
            author = text;
            break;
        }
    }

    let postBody = "";
    // Robust selector for text blocks
    const textDivs = postElement.querySelectorAll('div[dir="auto"], span[dir="auto"], div[data-ad-preview="message"]');
    const ignoreList = ['Like', 'Comment', 'Share', 'Send', 'Thích', 'Bình luận', 'Chia sẻ', 'Gửi'];
    for (let div of textDivs) {
        let text = div.textContent.trim();
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

    // Clean up trailing 'Xem thêm' or 'See more' that might have snuck in (including unicode ellipsis '…')
    postBody = postBody.replace(/…?\s*Xem thêm$/i, '')
                       .replace(/\.\.\.\s*Xem thêm$/i, '')
                       .replace(/…?\s*See more$/i, '')
                       .replace(/\.\.\.\s*See more$/i, '')
                       .replace(/…$/, '')
                       .replace(/\.\.\.$/, '')
                       .trim();

    return { author, body: postBody };
}

// 3. Render a post
function renderPost(postData) {
    if (!cliOverlay) return null;
    
    const postDiv = document.createElement('div');
    postDiv.className = 'fb-cli-post';
    postDiv.innerHTML = `
        <div class="fb-cli-header"><span class="prompt">${escapeHtml(postData.author)}@fb:~$</span> </div>
        <div class="fb-cli-text">${escapeHtml(postData.body)}</div>
    `;
    cliOverlay.appendChild(postDiv);
    
    // We intentionally do NOT auto-scroll here.
    // Appending a child naturally extends the scrollHeight without moving the user's viewport.
    // This allows the user to read at their own pace without being dragged down.
    
    return postDiv;
}

function updatePost(postDiv, postData) {
    const textDiv = postDiv.querySelector('.fb-cli-text');
    if (textDiv) {
        textDiv.innerHTML = escapeHtml(postData.body);
        // We removed programmatic scroll adjustment here because modern browsers 
        // handle 'scroll anchoring' natively. Manual adjustment was causing the jumps!
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
            // Create unique ID based on author and a small snippet of the text (20 chars) to ensure it stays stable even if 'Xem thêm' is stripped
            const snippet = postData.body.substring(0, 20).replace(/\s/g, '');
            const uniqueId = `${postData.author}_${snippet}`;
            
            if (!processedPosts.has(uniqueId)) {
                // Mark it as processed immediately to prevent duplicates entering the queue
                processedPosts.set(uniqueId, { length: postData.body.length, element: null });
                
                // Add to the slow-print queue
                printQueue.push(() => {
                    const postDiv = renderPost(postData);
                    // Save the actual DOM element so it can be updated if "See more" triggers
                    const existing = processedPosts.get(uniqueId);
                    if (existing) {
                        existing.element = postDiv;
                    }
                });
            } else {
                // It's already in the CLI! But did the text expand because we clicked "See more"?
                const existingData = processedPosts.get(uniqueId);
                // If the new body is strictly longer than the old body, update it!
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
        // If we clicked, Facebook needs a split second to fetch the rest of the text.
        // We defer extraction slightly to give it a head start, though the MutationObserver will also catch it.
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

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initOverlay();
        startObserver();
    });
} else {
    initOverlay();
    startObserver();
}
