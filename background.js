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

// --- Generic function to send data to the target tab ---
function sendDataToTarget(data, type, sendInForeground) {
    chrome.storage.sync.get(DEFAULTS, (storageData) => {
        const { settings } = storageData;
        const targetTabIndex = settings.targetTabIndex - 1;

        chrome.tabs.query({ index: targetTabIndex }, (tabs) => {
            if (tabs.length > 0) {
                const targetTab = tabs[0];

                const funcToInject = type === 'image' ? insertImageAndSubmit : fillInputAndSubmit;

                chrome.scripting.executeScript({
                    target: { tabId: targetTab.id },
                    function: funcToInject,
                    args: [data, settings.submitKey]
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
        sendDataToTarget(request.text, 'text', request.sendInForeground);
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
                        sendDataToTarget(selectedText, 'text', false);
                    }
                }
            });
        } else if (command === "send-pointed-text") {
            // Send a message to the content script to get the data under the cursor
            chrome.tabs.sendMessage(currentTab.id, { action: "getPointedText" }, (response) => {
                if (chrome.runtime.lastError) {
                    console.warn("Could not communicate with content script:", chrome.runtime.lastError.message);
                    return;
                }
                // Check if the response has valid data
                if (response && response.type && response.type !== 'empty' && response.data) {
                    const data = response.data.trim();
                    if (data) {
                        sendDataToTarget(data, response.type, false);
                    }
                }
            });
        }
    });
});

/**
 * Injected function to insert an image into a content-editable field.
 * @param {string} imageUrl - The URL of the image to insert.
 * @param {string} submitKey - The key combination to simulate for submission.
 */
function insertImageAndSubmit(imageUrl, submitKey) {
    const inputField = document.querySelector('[contenteditable="true"]');

    if (!inputField) {
        alert("Could not find a content-editable input field on the target page.");
        return;
    }

    inputField.focus();
    // Use `insertHTML` to add the image tag to the content-editable area
    document.execCommand('insertHTML', false, `<img src="${imageUrl}" />`);

    // The rest of the submission logic is similar to the text submission
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
    }, 100);
}


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