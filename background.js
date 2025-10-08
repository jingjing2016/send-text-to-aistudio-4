// background.js

const DEFAULTS = {
    settings: {
        targetTabIndex: 1,
        submitKey: 'ctrl-enter',
        position: {
            anchor: 'top-right',
            offsetX: 0,
            offsetY: 0
        }
    }
};

// --- Refactored function to send text ---
function sendTextToTarget(text, sendInForeground) {
    chrome.storage.sync.get(DEFAULTS, (data) => {
        const { settings } = data;
        const targetTabIndex = settings.targetTabIndex - 1;

        chrome.tabs.query({ index: targetTabIndex }, (tabs) => {
            if (tabs.length > 0) {
                const targetTab = tabs[0];
                chrome.scripting.executeScript({
                    target: { tabId: targetTab.id },
                    function: fillInputAndSubmit,
                    args: [text, settings.submitKey]
                }, () => {
                    if (sendInForeground) {
                        chrome.tabs.update(targetTab.id, { active: true });
                        chrome.windows.update(targetTab.windowId, { focused: true });
                    }
                });
            } else {
                console.warn(`Send Text: No tab found at index ${settings.targetTabIndex}.`);
                chrome.notifications.create({
                    type: 'basic',
                    iconUrl: 'icon.png',
                    title: 'Send Text Failed',
                    message: `Could not find a tab at position ${settings.targetTabIndex}.`
                });
            }
        });
    });
}

// --- Listener for messages from content script (icon click) ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "sendText" && request.text) {
        sendTextToTarget(request.text, request.sendInForeground);
    }
    return true; // Indicates asynchronous response
});

// --- Listener for the keyboard shortcut ---
chrome.commands.onCommand.addListener((command) => {
    // Get the currently active tab first, as both commands need it
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length === 0) {
            return; // No active tab found
        }
        const currentTab = tabs[0];

        if (command === "send-selected-text") {
            // Execute a script to get the selected text
            chrome.scripting.executeScript({
                target: { tabId: currentTab.id },
                function: () => window.getSelection().toString()
            }, (injectionResults) => {
                if (chrome.runtime.lastError) {
                    console.error(chrome.runtime.lastError.message);
                    return;
                }
                if (injectionResults && injectionResults[0] && injectionResults[0].result) {
                    const selectedText = injectionResults[0].result.trim();
                    if (selectedText) {
                        sendTextToTarget(selectedText, false); // `false` = send in the background
                    }
                }
            });
        } else if (command === "send-pointed-text") {
            // Send a message to the content script to get the text under the cursor
            chrome.tabs.sendMessage(currentTab.id, { action: "getPointedText" }, (response) => {
                if (chrome.runtime.lastError) {
                    // This can happen if the content script is not yet injected on a page.
                    // We can log it, but in most cases, the user will just try again.
                    console.warn("Could not communicate with content script:", chrome.runtime.lastError.message);
                    return;
                }
                if (response && response.text) {
                    const pointedText = response.text.trim();
                    if (pointedText) {
                        sendTextToTarget(pointedText, false); // `false` = send in the background
                    }
                }
            });
        }
    });
});

/**
 * This function is injected into the target page.
 * It fills an input field and simulates a keypress to submit.
 * @param {string} text - The text to fill.
 * @param {string} submitKey - The key to simulate ('enter' or 'ctrl-enter').
 */
function fillInputAndSubmit(text, submitKey) {
    const inputField = document.querySelector('textarea, [contenteditable="true"]');
    
    if (!inputField) {
        // If no input field is found, try again after a delay.
        setTimeout(() => {
            const fallbackInputField = document.querySelector('textarea, [contenteditable="true"]');
            if (fallbackInputField) {
                fillInputAndSubmit(text, submitKey);
            } else {
                alert("Could not find a suitable input field on the target page.");
            }
        }, 1000);
        return;
    }

    // --- Step 1: Fill the text ---
    if (inputField.isContentEditable) {
        inputField.focus();
        document.execCommand('insertText', false, text);
    } else {
        inputField.value = text;
        inputField.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // --- Step 2: Simulate the keypress after a short delay ---
    // The delay gives frameworks like React time to process the input change
    // and enable/update any relevant UI elements like a submit button.
    setTimeout(() => {
        const useCtrlKey = submitKey === 'ctrl-enter';
        const useAltKey = submitKey === 'alt-enter';
        const commonEventProps = {
            key: 'Enter',
            code: 'Enter',
            ctrlKey: useCtrlKey,
            altKey: useAltKey,
            bubbles: true,
            cancelable: true
        };

        const keydownEvent = new KeyboardEvent('keydown', commonEventProps);
        inputField.dispatchEvent(keydownEvent);

        const keyupEvent = new KeyboardEvent('keyup', commonEventProps);
        inputField.dispatchEvent(keyupEvent);
    }, 100); // 100ms delay
}