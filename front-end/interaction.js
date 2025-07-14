import { characterAudio, characterAudioQueue } from './virtualcharacter.js';
var typewriterRunning = false; // Global flag to control typewriter effect
var nextNode = 1;
var nextResponse = "";

var dialogueText = document.getElementById('dialogue-text');
var formContainer = document.getElementById('form-container');
var optionsContainer = document.getElementById('options-container');
var audioContainer = document.getElementById('audio-container');
var startBtn = document.getElementById('start-btn');
var chatBody = document.getElementById('chat-body');


document.addEventListener('DOMContentLoaded', (event) => {
    dialogueText = document.getElementById('dialogue-text');
    formContainer = document.getElementById('form-container');
    optionsContainer = document.getElementById('options-container');
    audioContainer = document.getElementById('audio-container');
    startBtn = document.getElementById('start-btn');
    chatBody = document.getElementById('chat-body');
    typewriterRunning = false; // Global flag to control typewriter effect
    nextNode = 1;
    nextResponse = "";

    startBtn.addEventListener('click', () => {
        startBtn.style.display = 'none';
        
        // Create a new agent message for the start
        const initialMessage = document.createElement('div');
        initialMessage.className = 'message agent';
        initialMessage.id = 'dialogue-text';
        initialMessage.textContent = "Hello there! I'm starting the demo now...";
        
        // Replace existing content with this new message
        chatBody.innerHTML = '';
        chatBody.appendChild(initialMessage);
        dialogueText = initialMessage;
        
        // Start the conversation
        handleUserInput(1, { userInput: "Start Introduction" });
    });
});


async function handleUserInput(nodeId, body) {
    const response = await fetch(`/Interaction/${nodeId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        console.error('Failed to fetch response:', response.statusText);
        return;
    }

    const contentType = response.headers.get('Content-Type');

    // Handle streamed response
    if (contentType && contentType.includes('prerecorded')) { // not expecting ANY streamed response
        // Handle pre-recorded response
        console.log("Pre-recorded responses");
        const data = await response.json(); // gives ENTIRE audio at once
        // process audio for front end
        await handlePreRecordedResponse(data);
    }
    else if (contentType && contentType.includes('application/json; charset=utf-8')) { // has some sort of ChatGPT element to it (streamed)
        console.log("Streamed Response.")
        const reader = response.body.getReader(); // getReader bc backend is writing stream by stream, not all at once, don't to close connection immedietely
        await handleStreamedResponse(reader);
    }
    else {
        console.error("Unknown response type. Unable to process.");
    }
}

async function handleStreamedResponse(reader) {
    const decoder = new TextDecoder();
    let partialData = '';
    var isFirstChunk = true;
    let currentAgentText = ''; // Variable to store current agent text

    while (true) {
        const { value, done } = await reader.read();

        if (done) {
            console.log('Stream completed.');
            break;
        }

        partialData += decoder.decode(value, { stream: true });

        // Process each complete JSON chunk
        let boundaryIndex;
        while ((boundaryIndex = partialData.indexOf('\n')) !== -1) {
            const chunk = partialData.slice(0, boundaryIndex).trim();
            partialData = partialData.slice(boundaryIndex + 1);

            if (chunk) {
                const data = JSON.parse(chunk);

                // Special handling for the first chunk
                if (isFirstChunk) {
                    console.log('Processing first chunk:', data);
                    // Handle audio if present
                    if (data.audio && data.audio.audioBase64) {
                        if (data.type == "PLACEHOLDER") { // agent lets user know is thinking about response as dynamic ChatGPT response is being generated
                            const audioData = await parseAudio(data.audio, null);
                            characterAudio(audioData, null); // placeholder always first speech in dialogue turn
                            // typewriter effect!
                            
                            // CHANGE: Start fresh with only the current dialogue text
                            currentAgentText = data.dialogue;
                            renderStreamedDialogue(currentAgentText, data.type);
                        }
                        else {
                            // first piece of dynamic response
                            isFirstChunk = false;
                            const audioData = await parseAudio(data.audio, null);
                            characterAudioQueue(audioData, null); // queue to play after placeholder ends
                            // only need to render front end input/buttons/stuff once
                            
                            // CHANGE: Start fresh with only the current dialogue
                            currentAgentText = data.dialogue;
                            renderStreamedDialogue(currentAgentText, data.type);
                            
                            renderInput(data.input, data.wholeDialogue);
                            // Render options if available
                            renderOptions(data.options, data.wholeDialogue);
                        }
                    }
                } else {
                    // keep rendering rest of audio stream as they come in!
                    if (data.audio && data.audio.audioBase64) {
                        const audioData = await parseAudio(data.audio, null);
                        characterAudioQueue(audioData, null);
                        
                        // CHANGE: Replace text with current dialogue instead of appending
                        currentAgentText = data.dialogue;
                        renderStreamedDialogue(currentAgentText, data.type);
                    }
                }
            }
        }
    }
}


async function handlePreRecordedResponse(data) {
    console.log('Received pre-recorded response:', data);
    // Handle audio if present; parse it for being ready for front end
    if (data.audio && data.audio.audioBase64) {
        const audioData = await parseAudio(data.audio, null);
        characterAudio(audioData, null);
    }

    // DISPLAYING STUFF TO FRONT END
    // Update dialogue - CHANGE: Pass whole dialogue to replace previous content
    renderDialogue(data.dialogue);
    renderInput(data.input, data.wholeDialogue);
    // Render options if available
    renderOptions(data.options, data.wholeDialogue);
}

// Important to Keep
async function parseAudio(audio, emoji) {
    console.log("parseAudio called with audio and emoji:", { audio, emoji });

    try {
        // Get the Base64 audio string
        const base64Audio = audio.audioBase64;

        // Decode the Base64 audio string into an ArrayBuffer
        const arrayBuffer = await fetch(`data:audio/wav;base64,${base64Audio}`)
            .then(response => response.arrayBuffer());
        console.log("Audio decoded into ArrayBuffer.");

        // Create an AudioContext
        const audioContext = new AudioContext();
        console.log("AudioContext created.");

        // Decode the ArrayBuffer into an AudioBuffer
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        console.log("AudioBuffer decoded:", audioBuffer);

        // Create a new audio object with the decoded AudioBuffer
        const audioWithWav = {
            ...audio,
            audio: audioBuffer,
            sampleRate: audioBuffer.sampleRate,
        };

        return audioWithWav;
    } catch (error) {
        console.error("Error decoding audio data:", error);
        throw error;
    }
}


// Function to render the dialogue text
function renderDialogue(dialogue) {
    // CHANGE: Replace the content instead of appending
    dialogueText.innerHTML = dialogue;

    // Add animation class
    if (!dialogueText.classList.contains('show')) {
        dialogueText.classList.add('show');
    }
}

function renderStreamedDialogue(dialogue, type, url = null) {
    if (type === "PLACEHOLDER") {
        dialogueText.innerHTML = dialogue; // Direct assignment for placeholder
        scrollChatToBottom();
    } else {
        // CHANGE: Set the content directly instead of appending
        typewriterRunning = true;
        let i = 0; // Character index

        // Typewriter effect
        function typeWriter() {
            if (!typewriterRunning) {
                // If the effect is canceled, instantly show remaining text
                cancelTypewriterEffect(dialogueText, dialogue, url);
                return;
            }
            if (i < dialogue.length) {
                // Replace content with what we've typed so far
                dialogueText.innerHTML = dialogue.substring(0, i+1);
                i++;
                
                // Scroll down as text is typed
                if (i % 5 === 0) { // Only scroll every few characters for performance
                    scrollChatToBottom();
                }
                
                setTimeout(typeWriter, 20); // Adjust speed (20ms per character)
            } else {
                // Ensure the class 'show' is added only once
                if (url) {
                    const link = document.createElement('a');
                    link.href = url;
                    link.target = '_blank'; // Opens link in a new tab
                    link.textContent = ' Read more'; // The space and link text
                    dialogueText.appendChild(link);
                }
                if (!dialogueText.classList.contains('show')) {
                    dialogueText.classList.add('show');
                }
                typewriterRunning = false; // Reset the flag when done
                scrollChatToBottom();
            }
        }

        typeWriter(); // Start typing animation
    }
}


function cancelTypewriterEffect(dialogueSection, wholeDialogue, url = null) {
    typewriterRunning = false;
    dialogueSection.innerHTML = wholeDialogue; // Instantly display the complete dialogue
    
    if (url) {
        // Create the hyperlink
        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank'; // Opens link in a new tab
        link.textContent = ' Read more'; // Add a space and link text
        dialogueSection.appendChild(link); // Append the hyperlink to the dialogue section
    }

    console.log("Typewriter effect canceled and completed instantly.");
}

// Function to render the input form
function renderInput(input, wholeDialogue, url = null) {
    formContainer.innerHTML = ''; // Clear any previous form
    const container = document.querySelector('.container');

    if (input) {
        container.classList.remove('no-form'); // Show the form section

        // Create a textarea input
        const inputElement = document.createElement('textarea');
        inputElement.classList.add('large-text');
        inputElement.placeholder = 'Type your response here...';

        // Create a wrapper for the button
        const buttonWrapper = document.createElement('div');
        buttonWrapper.className = 'form-button-wrapper';

        // Create a submit button
        const submitButton = document.createElement('button');
        submitButton.className = 'game-button';
        submitButton.innerText = 'Send';

        // Create a loading spinner (hidden by default)
        const loadingSpinner = document.createElement('div');
        loadingSpinner.className = 'loading-spinner';
        loadingSpinner.style.display = 'none'; // Initially hidden

        // Add event listener to send button
        submitButton.addEventListener('click', () => {
            if (inputElement.value.trim() !== "") {
                cancelTypewriterEffect(dialogueText, wholeDialogue, url);

                // CHANGE: Replace user message instead of adding a new one
                addUserMessage(inputElement.value.trim());

                // Disable input and button, show loading spinner
                var inputElementValue = inputElement.value;
                inputElement.disabled = true; // Disable input
                submitButton.disabled = true; // Disable button
                submitButton.style.display = 'none'; // Hide the button
                loadingSpinner.style.display = 'inline-block'; // Show spinner
                nextNode = input.nextNode;
                nextResponse = inputElementValue;
                // Send response
                handleUserInput(nextNode, { alexInput: wholeDialogue, userInput: inputElementValue });
            } else {
                alert("Please enter a response.");
            }
        });

        // Add event listener for Enter key
        inputElement.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault(); // Prevent default to avoid newline
                submitButton.click(); // Trigger the click event on the send button
            }
        });

        // Append the spinner to the wrapper
        buttonWrapper.appendChild(submitButton);
        buttonWrapper.appendChild(loadingSpinner);

        // Append input and button wrapper to the form container
        formContainer.appendChild(inputElement);
        formContainer.appendChild(buttonWrapper);
    } else {
        container.classList.add('no-form'); // Hide the form section when there's no input
    }
}

// Function to scroll chat to bottom
function scrollChatToBottom() {
    const chatBody = document.getElementById('chat-body');
    if (chatBody) {
        chatBody.scrollTop = chatBody.scrollHeight;
    }
}

// Function to add a user message to the chat
function addUserMessage(text) {
    // CHANGE: Look for existing user message
    let userMessage = chatBody.querySelector('.message.user');
    
    if (userMessage) {
        // Update existing user message
        userMessage.textContent = text;
    } else {
        // Create a new user message if none exists
        userMessage = document.createElement('div');
        userMessage.className = 'message user';
        userMessage.textContent = text;
        chatBody.appendChild(userMessage);
    }
    
    // Scroll to bottom
    scrollChatToBottom();
}

// Function to add or update agent message
function updateAgentMessage(text) {
    // CHANGE: Always update the existing agent message
    if (dialogueText) {
        dialogueText.textContent = text;
    } else {
        // Create a new agent message if none exists
        const agentMessage = document.createElement('div');
        agentMessage.className = 'message agent';
        agentMessage.id = 'dialogue-text';
        agentMessage.textContent = text;
        chatBody.appendChild(agentMessage);
        dialogueText = agentMessage;
    }
    
    // Scroll to bottom
    scrollChatToBottom();
}

// Function to render the options
function renderOptions(options, wholeDialogue, url) {
    optionsContainer.innerHTML = ''; // Clear previous options

    if (options && options.length > 0) {
        const isSingleOption = options.length === 1; // Check if there's only one option

        options.forEach(option => {
            // Create the main button
            const button = document.createElement('button');
            button.className = isSingleOption || option.optionText === "I'd like to move onto the next topic of the conversation"
                ? "move-button"
                : "game-button";
            button.innerText = option.optionText;

            // Add scalable spacing around buttons
            button.style.margin = "0.5em"; // Use `em` for spacing

            // Add event listener to send response with additional data
            button.addEventListener('click', () => {
                // CHANGE: Replace user message with selected option
                addUserMessage(option.optionText);
                
                // Disable all inputs
                const inputElement = document.querySelector('.large-text');
                const sendButton = document.querySelector('.game-button');
                if (inputElement) inputElement.disabled = true;
                if (sendButton) sendButton.disabled = true;

                // Clear options and show loading spinner
                optionsContainer.innerHTML = ''; // Remove all buttons
                cancelTypewriterEffect(dialogueText, wholeDialogue, url);

                const loadingSpinner = document.createElement('div');
                loadingSpinner.className = 'loading-spinner';
                loadingSpinner.style.display = 'inline-block'; // Show spinner
                optionsContainer.appendChild(loadingSpinner);

                const additionalData = {
                    alexInput: wholeDialogue,
                    userInput: option.optionText // Include the text of the selected option
                };
                handleUserInput(option.nextNode, additionalData); // Pass additionalData to handleUserInput
            });

            optionsContainer.appendChild(button);
        });
    }
}