import { runFlow } from './flow-runner.js';
import { populateEditor, populateFlowList, populateOutputImages, insertStep, removeStep, populateInputImages } from './ui.js';
import { getFlows, saveFlows } from './store.js';
import { getUniqueId, extractImagesFromDataTransfer, download } from './utils.js';
import { ImageViewer } from './image-viewer.js';

const homeLink = document.querySelector('h1 a');
const welcomePage = document.querySelector('.welcome');
const editorPage = document.querySelector('.editor');
const imagesPage = document.querySelector('.images');
const runFlowButton = document.querySelector('.run-flow');
const addFlowButton = document.querySelector('.add-flow');
const deleteFlowButton = document.querySelector('.delete-flow');
const downloadImagesButton = document.querySelector('.download-images');
const saveImagesButton = document.querySelector('.save-images');
const useOutputAsInputButton = document.querySelector('.use-output-as-input');
const browseImagesButton = document.querySelector('.browse-images');
const randomImagesButton = document.querySelector('.use-random-images');
const removeInputButton = document.querySelector('.remove-input');
const viewImagesButton = document.querySelector('.view-images');
const imageViewerDialog = document.querySelector('.image-viewer');

let flowsPromise = getFlows();
let currentFlow = null;
let currentId = null;
let currentImages = [];
let outputImages = [];
const imageViewer = new ImageViewer(imageViewerDialog);

async function navigateToHome() {
  currentFlow = null;
  currentId = null;

  welcomePage.classList.remove('hidden');
  editorPage.classList.add('hidden');
  imagesPage.classList.add('hidden');

  document.querySelectorAll(`.flow-in-list.selected`).forEach(f => f.classList.remove('selected'));
}

async function navigateToFlow(id) {
  currentId = id;
  const flows = await flowsPromise;
  currentFlow = flows.find(f => id === f.id + '');

  populateFlowList(flows);

  if (!currentFlow) {
    await navigateToHome();
    return;
  }

  welcomePage.classList.add('hidden');
  editorPage.classList.remove('hidden');
  imagesPage.classList.remove('hidden');

  // Mark the current flow as selected in the sidebar.
  document.querySelectorAll(`.flow-in-list.selected`).forEach(f => f.classList.remove('selected'));
  document.querySelector(`.flow-in-list[data-id="${id}"]`).classList.add('selected');

  populateEditor(currentFlow);
}

// Handle links.
homeLink.addEventListener('click', navigateToHome);
addEventListener('click', async e => {
  const flowLink = e.target.closest('.flow-in-list');
  if (flowLink) {
    await navigateToFlow(flowLink.dataset.id);
  }
});

// Run the current flow.
runFlowButton.addEventListener('click', async e => {
  if (!currentImages.length) {
    return;
  }

  populateOutputImages([]);

  document.documentElement.classList.add('running');
  runFlowButton.disabled = true;

  const processedFiles = await runFlow(currentFlow, currentImages.map(i => {
    if (!i.file.name) {
      i.file.name = i.name;
    }
    return i.file;
  }));
  if (processedFiles) {
    // Store the new images in the outputImages array.
    outputImages = processedFiles.outputFiles;

    // Display the images.
    const imageSources = processedFiles.outputFiles.map(file => {
      return { src: URL.createObjectURL(file.blob), name: file.name };
    });
    populateOutputImages(imageSources, currentImages[0].fsHandlePromise);
  }

  document.documentElement.classList.remove('running');
  runFlowButton.disabled = false;
});

// Handle flow changes.
addEventListener('change', async e => {
  // One of the inputs changed in the editor. This could be the name of the flow
  // or one of the params for a step.
  if (e.target.closest('.editor')) {
    await handleFlowChange(true);
  }
});

// A step was moved within the flow. Update.
addEventListener('flow-change', handleFlowChange);

/**
 * When a flow was changed (title, steps, order of steps, params, etc.), call
 * this function to save the changes and reload the UI.
 * @param {Boolean} dontUpdateEditor Pass true if you don't need the editor UI part
 * to be reloaded. This is useful when a param was changed for example. This doesn't
 * require to reload the editor since the param is already updated in the input.
 * And reloading the editor would reset the focus.
 */
async function handleFlowChange(dontUpdateEditor) {
  // Something changed in the editor.
  // Save the current flow to the local flows variable, and to the store.
  const stepElements = [...editorPage.querySelectorAll('.step')];
  currentFlow.steps = stepElements.map(stepElement => {
    const type = stepElement.dataset.type;
    const params = [...stepElement.querySelectorAll('.step-param input, .step-param select')].map(i => i.value);
    return { type, params };
  });

  const newName = editorPage.querySelector('.flow-name').value;
  currentFlow.name = newName;

  const flows = await flowsPromise;
  const flowIndex = flows.findIndex(f => f.id === currentFlow.id);
  flows[flowIndex] = currentFlow;

  await saveFlows(flows);

  populateFlowList(flows, currentId);
  if (!dontUpdateEditor) {
    populateEditor(currentFlow);
  }
}

// Adding a step to the current flow.
addEventListener('click', async e => {
  const addStepButton = e.target.closest('.editor .add-step');
  if (!addStepButton || !currentFlow) {
    return;
  }

  const index = parseInt(addStepButton.dataset.index, 10);
  await insertStep(index);

  handleFlowChange();
});

// Removing a step from the current flow.
addEventListener('click', e => {
  const removeStepButton = e.target.closest('.editor .step .remove-step');
  if (!removeStepButton || !currentFlow) {
    return;
  }

  const index = parseInt(removeStepButton.dataset.index, 10);
  removeStep(index);

  handleFlowChange();
});

// Adding a new flow.
addFlowButton.addEventListener('click', async e => {
  const flows = await flowsPromise;
  const newFlow = {
    id: getUniqueId(),
    name: 'Untitled flow',
    steps: []
  };

  flows.push(newFlow);
  await saveFlows(flows);

  populateFlowList(flows);

  await navigateToFlow(newFlow.id);
});

// Create a new flow with specific settings
async function createNewFlow(name, steps) {
  const flows = await flowsPromise;
  const newFlow = {
    id: getUniqueId(),
    name: name || 'Untitled flow',
    steps: steps || []
  };

  flows.push(newFlow);
  await saveFlows(flows);

  populateFlowList(flows);

  await navigateToFlow(newFlow.id);
  return newFlow;
}

// Deleting the current flow.
deleteFlowButton.addEventListener('click', async e => {
  const flows = await flowsPromise;
  const flowIndex = flows.findIndex(f => f.id === currentFlow.id);
  flows.splice(flowIndex, 1);
  await saveFlows(flows);

  populateFlowList(flows);

  await navigateToHome();
});

// Handle drag/drop images in the app.
addEventListener('dragstart', e => {
  // We only handle images being dragged from outside the app.
  // So disable any drag/drop inside the app.
  e.preventDefault();
});

addEventListener('dragover', e => {
  e.preventDefault();

  const images = extractImagesFromDataTransfer(e);
  if (!images.length) {
    return;
  }

  document.documentElement.classList.add('dropping-images');
});

addEventListener('dragleave', e => {
  e.preventDefault();

  const images = extractImagesFromDataTransfer(e);
  if (!images.length) {
    return;
  }

  document.documentElement.classList.remove('dropping-images');
});

addEventListener('drop', async (e) => {
  e.preventDefault();

  const images = extractImagesFromDataTransfer(e);
  if (!images.length) {
    return;
  }

  document.documentElement.classList.remove('dropping-images');

  // Store the current images.
  currentImages = images;
  populateInputImages(images.map(image => {
    return { src: URL.createObjectURL(image.file), name: image.file.name };
  }));
});

// Handle browse images button.
browseImagesButton.addEventListener('click', async e => {
  const imagesToStore = [];

  if (!('showOpenFilePicker' in window)) {
    // Browser doesn't support the File System Access API.
    // Use the legacy file input.
    const button = document.createElement('input');
    button.type = 'file';
    button.multiple = true;
    button.accept = 'image/*';
    button.style.display = 'none';

    await new Promise(resolve => {
      button.addEventListener('change', async e => {
        const files = [...e.target.files];

        for (const file of files) {
          imagesToStore.push({
            file,
            fsHandlePromise: Promise.resolve(null)
          });
          resolve();
        }
      }, { once: true });

      button.click();
    });
  } else {
    // Browser supports the File System Access API.
    const handles = await showOpenFilePicker({
      multiple: true,
      types: [
        {
          description: 'Images',
          accept: {
            'image/*': ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg']
          }
        }
      ]
    });

    for (const handle of handles) {
      imagesToStore.push({
        file: await handle.getFile(),
        fsHandlePromise: Promise.resolve(handle)
      });
    }
  }

  // Store the current images.
  currentImages = imagesToStore;
  populateInputImages(imagesToStore.map(image => {
    return { src: URL.createObjectURL(image.file), name: image.file.name };
  }));
});

// Handle random image button.
randomImagesButton.addEventListener('click', async e => {
  const nb = Math.ceil(Math.random() * 3) + 2;

  const imagesToStore = [];
  for (let i = 0; i < nb; i++) {
    const w = Math.floor(600 + Math.random() * 800);
    const h = Math.floor(400 + Math.random() * 800);

    const image = await fetch(`https://picsum.photos/${w}/${h}`);
    const blob = await image.blob();
    const file = new File([blob], `random-${i + 1}.jpg`, { type: 'image/jpeg' });

    imagesToStore.push({
      file,
      fsHandlePromise: Promise.resolve(null)
    });
  }

  currentImages = imagesToStore;
  populateInputImages(imagesToStore.map(image => {
    return { src: URL.createObjectURL(image.file), name: image.file.name };
  }));
});

// Handle remove input images button.
removeInputButton.addEventListener('click', async e => {
  currentImages = [];
  populateInputImages([]);

  runFlowButton.disabled = true;
});

// Handle save/save-as/download.
const hasImagesToSave = () => outputImages.length;

saveImagesButton.addEventListener('click', async e => {
  if (!hasImagesToSave()) {
    return;
  }

  // If the input images were cloned, we can't save the new images
  // back to disk. They don't have a handle. Just bail out for now.
  if (currentImages.length !== outputImages.length) {
    return;
  }

  for (const outputImage of outputImages) {
    // Find the handle.
    const handle = await currentImages.find(i => i.file.name === outputImage.name).fsHandlePromise;
    const writable = await handle.createWritable();
    await writable.write(outputImage.blob);
    await writable.close();
  }
});

downloadImagesButton.addEventListener('click', async e => {
  if (!hasImagesToSave()) {
    return;
  }

  for (const image of outputImages) {
    download(image.blob, image.name);
  }
});

// Handle the output-as-input button.
useOutputAsInputButton.addEventListener('click', async e => {
  if (!hasImagesToSave()) {
    return;
  }

  currentImages = outputImages.map(img => {
    return { file: img.blob, name: img.name };
  });
  outputImages = [];

  populateInputImages(currentImages.map(image => {
    return { src: URL.createObjectURL(image.file), name: image.name };
  }));
  populateOutputImages([]);
});

// Handle the view images button.
viewImagesButton.addEventListener('click', async e => {
  if (!hasImagesToSave()) {
    return;
  }

  const output = outputImages.sort((a, b) => a.name.localeCompare(b.name)).map(image => {
    return { src: URL.createObjectURL(image.blob), name: image.name };
  });
  const input = currentImages.sort((a, b) => a.file.name.localeCompare(b.file.name)).map(image => {
    return { src: URL.createObjectURL(image.file), name: image.file.name };
  });

  imageViewer.show();

  // 2 modes: either we matching inputs and outputs in which case we can 
  // go into the swipe mode. Or we don't, in which case we just show the
  // output images.
  if (input.length === output.length) {
    imageViewer.populateFromInputAndOutput(input, output);
  } else {
    imageViewer.populateFromOutput(output);
  }
});

// Process share target data when the app is launched
async function processShareTargetData() {
  // Check if we were launched via share target
  const urlParams = new URLSearchParams(window.location.search);
  const isShared = urlParams.get('share') === 'true';
  
  if (!isShared) {
    return;
  }
  
  try {
    // Get the shared data from the cache
    const shareCache = await caches.open('share-target-cache');
    const shareDataResponse = await shareCache.match('shareData');
    
    if (!shareDataResponse) {
      console.warn('No share data found in cache');
      return;
    }
    
    const shareData = await shareDataResponse.json();
    console.log('Share data received:', shareData);
    
    if (shareData.fileCount <= 0) {
      console.warn('No files in the shared data');
      return;
    }
    
    // Determine flow configuration from share data
    const { flowTitle, flowSteps } = determineFlowConfiguration(shareData);
    
    // Create or navigate to the flow
    const targetFlow = await createOrNavigateToFlow(flowTitle, flowSteps);
    
    // Load and process the shared images
    await loadAndProcessSharedImages(shareCache, shareData);
    
    // Clean up cache after processing
    await cleanupShareCache(shareCache, shareData);
  } catch (err) {
    console.error('Error processing share target data:', err);
  }
  
  // Remove the share parameter from URL without page reload
  window.history.replaceState({}, document.title, window.location.pathname);
}

// Determines the flow configuration (title and steps) based on shared data
function determineFlowConfiguration(shareData) {
  // Default flow title and steps
  let flowTitle = shareData.title || 'Shared Images Flow';
  let flowSteps = [
    {
      type: 'resize-width-if-larger',
      params: [1000]
    }
  ];
  
  // If URL field exists and starts with web+wami://, use it for configuration
  if (shareData.url && shareData.url.trim() !== '') {
    const url = shareData.url.trim();
    console.log('URL in share data:', url);
    
    if (url.startsWith('web+wami://')) {
      const result = parseWebWamiUrl(url);
      if (result) {
        flowTitle = result.title;
        flowSteps = result.steps;
      }
    }
  }
  
  return { flowTitle, flowSteps };
}

// Parses a web+wami:// URL to extract flow configuration
function parseWebWamiUrl(url) {
  // Extract the part after web+wami://
  const urlPath = url.substring('web+wami://'.length);
  if (!urlPath || !urlPath.trim()) {
    return null;
  }
  
  // Get the path without query parameters
  const pathParts = urlPath.split('?')[0].split('/');
  const mainCommand = pathParts[0].toLowerCase();
  
  // Set flow title based on the URL path
  const title = decodeURIComponent(urlPath).replace(/\/+/g, ' ').trim();
  console.log('Using URL path as flow name:', title);
  
  // Determine the flow steps based on URL pattern
  let steps = [];
  
  if (mainCommand.includes('rotate')) {
    console.log('Creating rotate flow');
    steps = [{ type: 'rotate', params: [90] }];
  } else if (mainCommand.includes('flip')) {
    console.log('Creating flip flow');
    steps = [{ type: 'flip', params: [] }];
  } else if (mainCommand.includes('paint')) {
    console.log('Creating paint flow');
    steps = [{ type: 'paint', params: [5] }];
  } else if (mainCommand.includes('sepia')) {
    console.log('Creating sepia flow');
    steps = [{ type: 'sepia-tone', params: [80] }];
  } else if (mainCommand.includes('blur')) {
    console.log('Creating blur flow');
    steps = [{ type: 'blur', params: [3] }];
  } else if (mainCommand.includes('negate')) {
    console.log('Creating negate flow');
    steps = [{ type: 'negate', params: [] }];
  } else if (mainCommand.includes('resize')) {
    // Try to extract width parameter
    const width = parseInt(pathParts[1]) || 1000;
    console.log(`Creating resize flow with width ${width}`);
    steps = [{ type: 'resize-width-if-larger', params: [width] }];
  } else {
    // Default to resize-width-if-larger
    steps = [{ type: 'resize-width-if-larger', params: [1000] }];
  }
  
  return { title, steps };
}

// Creates a new flow or navigates to an existing flow with the same name
async function createOrNavigateToFlow(flowTitle, flowSteps) {
  // Only auto-process if title contains ai-action
  const shouldAutoProcess = true;
  
  // Check if a flow with this name already exists
  const flows = await flowsPromise;
  const existingFlow = flows.find(flow => flow.name === flowTitle);
  
  let targetFlow;
  
  // If a flow with the same name exists, update its steps and use it
  if (existingFlow) {
    console.log(`Using existing flow: "${flowTitle}" with ID ${existingFlow.id}`);
    
    // Update the flow steps to match the requested configuration
    if (shouldAutoProcess) {
      existingFlow.steps = [...flowSteps];
      
      // Save the updated flow
      const flowIndex = flows.findIndex(flow => flow.id === existingFlow.id);
      flows[flowIndex] = existingFlow;
      await saveFlows(flows);
      console.log(`Updated steps for flow: "${flowTitle}"`);
    }
    
    targetFlow = existingFlow;
    // Navigate to the existing flow
    await navigateToFlow(existingFlow.id + '');
  } else {
    // Create a new flow with selected steps
    console.log(`Creating new flow: "${flowTitle}" with steps:`, flowSteps);
    targetFlow = await createNewFlow(
      flowTitle, 
      shouldAutoProcess ? flowSteps : []
    );
  }
  
  return targetFlow;
}

// Loads shared images from the cache and processes them if needed
async function loadAndProcessSharedImages(shareCache, shareData) {
  const imagesToStore = [];
  
  // Load the shared files from cache
  for (let i = 0; i < shareData.fileCount; i++) {
    const fileResponse = await shareCache.match(`file-${i}`);
    if (fileResponse) {
      const blob = await fileResponse.blob();
      
      // Use the exact original filename stored in the shareData
      let fileName;
      
      if (shareData.fileNames && shareData.fileNames[i]) {
        fileName = shareData.fileNames[i];
        console.log(`Using original file name: ${fileName}`);
      } else {
        // Only fall back if absolutely necessary
        fileName = `shared-${i + 1}.${getFileExtension(blob.type)}`;
        console.log(`No filename found, using fallback: ${fileName}`);
      }
      
      const file = new File([blob], fileName, { type: blob.type });
      
      imagesToStore.push({
        file,
        name: fileName,
        fsHandlePromise: Promise.resolve(null)
      });
    }
  }
  
  // Store the images and update the UI
  if (imagesToStore.length > 0) {
    console.log(`Loaded ${imagesToStore.length} images from share`);
    currentImages = imagesToStore;
    populateInputImages(imagesToStore.map(image => {
      return { src: URL.createObjectURL(image.file), name: image.file.name };
    }));
    
    // Automatically run the flow
    const shouldAutoProcess = true;
    if (shouldAutoProcess) {
      console.log('Auto-processing images...');
      setTimeout(() => {
        runFlowButton.click();
      }, 500);
    }
  }
}

// Cleans up the share cache after processing
async function cleanupShareCache(shareCache, shareData) {
  await shareCache.delete('shareData');
  for (let i = 0; i < shareData.fileCount; i++) {
    await shareCache.delete(`file-${i}`);
  }
}

// Helper function to get file extension from mime type
function getFileExtension(mimeType) {
  const extensions = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg'
  };
  
  return extensions[mimeType] || 'jpg';
}

// When the app starts, get the flows and display them in the sidebar.
async function startApp() {
  const flows = await flowsPromise;
  populateFlowList(flows);

  // Also toggle the download/save buttons depending on capabilities.
  if (!('showOpenFilePicker' in window)) {
    saveImagesButton.remove();
  }
  
  // Process share target data if available
  await processShareTargetData();
  
  logProtocolActivation();
}

// Log protocol activations.
function logProtocolActivation() {
  const url = new URL(window.location.href);
  const protocolUrl = url.searchParams.get('url');
  
  // If we have a URL parameter that starts with web+wami:, it's a protocol activation
  if (protocolUrl && protocolUrl.startsWith('web+wami:')) {
    console.log(`Protocol activation detected: ${protocolUrl}`);
    
    // Clean up the URL.
    if (window.history && window.history.replaceState) {
      url.searchParams.delete('url');
      window.history.replaceState({}, document.title, url.toString());
    }
  }
}

startApp();
