// popup.js
window.popup_element = null;  // Global reference to popup element
window.hide_timer = null;

async function getAllTags() {
  const { entries = [] } = await chrome.storage.sync.get('entries');
  return [...new Set(entries.flatMap(entry => entry.tags))]
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

async function sendToArchiveBox(url, tags) {
  const { archivebox_server_url, archivebox_api_key } = await chrome.storage.sync.get([
    'archivebox_server_url',
    'archivebox_api_key'
  ]);

  if (!archivebox_server_url || !archivebox_api_key) {
    return { ok: false, status: 'Server not configured' };
  }

  try {
    console.log('i Sending to ArchiveBox', { endpoint: `${archivebox_server_url}/api/v1/cli/add`, method: 'POST', url, tags });
    const response = await fetch(`${archivebox_server_url}/api/v1/cli/add`, {
      method: 'POST', 
      mode: 'no-cors',
      credentials: 'omit',
      body: JSON.stringify({
        api_key: archivebox_api_key,
        urls: [url],
        tag: tags.join(','),
        depth: 0,
        update: false,
        update_all: false,
      }),
    });

    return {
      ok: response.ok,
      status: `${response.status} ${response.statusText}`
    };
  } catch (err) {
    return { ok: false, status: `Connection failed ${err}` };
  }
}

window.getCurrentEntry = async function() {
  const { entries = [] } = await chrome.storage.sync.get('entries');
  let current_entry = entries.find(entry => entry.url === window.location.href);
  
  if (!current_entry) {
    current_entry = {
      id: crypto.randomUUID(),
      url: String(window.location.href),
      timestamp: new Date().toISOString(),
      tags: [],
      title: document.title,
      notes: '',
    };
    entries.push(current_entry);
    await chrome.storage.sync.set({ entries });  // Save immediately
  }
  current_entry.id = current_entry.id || crypto.randomUUID();
  current_entry.url = current_entry.url || window.location.href;
  current_entry.timestamp = current_entry.timestamp || new Date().toISOString();
  current_entry.tags = current_entry.tags || [];
  current_entry.title = current_entry.title || document.title;
  current_entry.notes = current_entry.notes || '';

  console.log('i Loaded current ArchiveBox snapshot', current_entry);
  return { current_entry, entries };  // Return both for atomic updates
}

window.getSuggestedTags = async function() {
  const { current_entry, entries } = await getCurrentEntry();
  // Get all unique tags sorted by recency, excluding current entry's tags
  return [...new Set(
    entries
      .filter(entry => entry.url !== current_entry.url)  // Better way to exclude current
      .reverse()
      .flatMap(entry => entry.tags)
  )]
  .filter(tag => !current_entry.tags.includes(tag))
  .slice(0, 3);
}

window.updateCurrentTags = async function() {
  if (!popup_element) return;
  const current_tags_div = popup_element.querySelector('.ARCHIVEBOX__current-tags');
  const status_div = popup_element.querySelector('small');
  const { current_entry } = await getCurrentEntry();

  // Update UI first
  current_tags_div.innerHTML = current_entry.tags.length 
    ? `${current_entry.tags
        .map(tag => `<span class="ARCHIVEBOX__tag-badge current" data-tag="${tag}">${tag}</span>`)
        .join(' ')}`
    : '';

  // Send to server
  const result = await sendToArchiveBox(current_entry.url, current_entry.tags);
  status_div.innerHTML = `
    <span class="status-indicator ${result.ok ? 'success' : 'error'}"></span>
    ${result.status}
  `;

  // Add click handlers for removing tags
  current_tags_div.querySelectorAll('.tag-badge.current').forEach(badge => {
    badge.addEventListener('click', async (e) => {
      if (e.target.classList.contains('current')) {
        const { current_entry, entries } = await getCurrentEntry();
        const tag_to_remove = e.target.dataset.tag;
        current_entry.tags = current_entry.tags.filter(tag => tag !== tag_to_remove);
        await chrome.storage.sync.set({ entries });
        await updateCurrentTags();
        await updateSuggestions();
      }
    });
  });
}

window.updateSuggestions = async function() {
  if (!popup_element) return;
  const suggestions_div = popup_element.querySelector('.ARCHIVEBOX__tag-suggestions');
  const suggested_tags = await getSuggestedTags();
  suggestions_div.innerHTML = suggested_tags.length 
    ? `${suggested_tags
        .map(tag => `<span class="ARCHIVEBOX__tag-badge suggestion">${tag}</span>`)
        .join(' ')}`
    : '';
}

window.createPopup = async function() {
  const { current_entry } = await getCurrentEntry();

  // Create popup container
  document.querySelector('.archive-box-popup')?.remove();
  popup_element = document.createElement('div');
  popup_element.className = 'archive-box-popup';
  popup_element.innerHTML = `
    <a href="#" class="options-link">🏛️</a>
    <input type="text" placeholder="Add tags + press ⏎   |   ⎋ to close">
    <br/>
    <div class="ARCHIVEBOX__current-tags"></div>
    <div class="ARCHIVEBOX__tag-suggestions"></div><br/>
    <small>
      <span class="status-indicator"></span>
      Saved
    </small>
  `;
  
  document.body.appendChild(popup_element);
  
  // Add click handler for options link
  popup_element.querySelector('.options-link').addEventListener('click', (e) => {
    console.log('i Clicked ArchiveBox popup options link');
    e.preventDefault();
    chrome.runtime.sendMessage({ action: 'openOptionsPage', id: current_entry.id });
  });
  
  const input = popup_element.querySelector('input');
  const suggestions_div = popup_element.querySelector('.ARCHIVEBOX__tag-suggestions');
  const current_tags_div = popup_element.querySelector('.ARCHIVEBOX__current-tags');
  
  // Initial display of current tags and suggestions
  await updateCurrentTags();
  await updateSuggestions();
  
  // Add click handlers for suggestion badges
  suggestions_div.addEventListener('click', async (e) => {
    if (e.target.classList.contains('suggestion')) {
      const { current_entry, entries } = await getCurrentEntry();
      const tag = e.target.textContent.replace(' +', '');
      if (!current_entry.tags.includes(tag)) {
        current_entry.tags.push(tag);
        await chrome.storage.sync.set({ entries });
      }
    }
    await updateCurrentTags();
    await updateSuggestions();
  });
  current_tags_div.addEventListener('click', async (e) => {
    if (e.target.classList.contains('current')) {
      const tag = e.target.dataset.tag;
      console.log('Removing tag', tag);
      const { current_entry, entries } = await getCurrentEntry();
      current_entry.tags = current_entry.tags.filter(t => t !== tag);
      await chrome.storage.sync.set({ entries });
      await updateCurrentTags();
      await updateSuggestions();
    }
  });

  // Add dropdown container
  const dropdownContainer = document.createElement('div');
  dropdownContainer.className = 'ARCHIVEBOX__autocomplete-dropdown';
  dropdownContainer.style.display = 'none';
  input.parentNode.insertBefore(dropdownContainer, input.nextSibling);

  let selectedIndex = -1;
  let filteredTags = [];

  async function updateDropdown() {
    const inputValue = input.value.toLowerCase();
    const allTags = await getAllTags();
    
    // Filter tags that match input
    filteredTags = allTags
      .filter(tag => tag.toLowerCase().includes(inputValue) && inputValue)
      .slice(0, 5);  // Limit to 5 suggestions

    if (filteredTags.length === 0) {
      dropdownContainer.style.display = 'none';
      return;
    }

    // Update dropdown content
    dropdownContainer.innerHTML = filteredTags
      .map((tag, index) => `
        <div class="ARCHIVEBOX__autocomplete-item ${index === selectedIndex ? 'selected' : ''}"
             data-tag="${tag}">
          ${tag}
        </div>
      `)
      .join('');
    
    dropdownContainer.style.display = 'block';
  }

  // Handle input changes
  input.addEventListener('input', updateDropdown);

  // Handle keyboard navigation
  input.addEventListener('keydown', async (e) => {
    if (!filteredTags.length) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, filteredTags.length - 1);
        updateDropdown();
        break;
      
      case 'ArrowUp':
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, -1);
        updateDropdown();
        break;
      
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0) {
          const selectedTag = filteredTags[selectedIndex];
          const { current_entry, entries } = await getCurrentEntry();
          
          if (!current_entry.tags.includes(selectedTag)) {
            current_entry.tags.push(selectedTag);
            await chrome.storage.sync.set({ entries });
            await updateCurrentTags();
            await updateSuggestions();
          }
          
          input.value = '';
          dropdownContainer.style.display = 'none';
          selectedIndex = -1;
          filteredTags = [];
        } else {
          // Handle regular tag input as before
          const { current_entry, entries } = await getCurrentEntry();
          const new_tags = input.value.split(',')
            .map(tag => tag.trim())
            .filter(tag => tag && !current_entry.tags.includes(tag));
          
          if (new_tags.length > 0) {
            current_entry.tags.push(...new_tags);
            await chrome.storage.sync.set({ entries });
            input.value = '';
            await updateSuggestions();
            await updateCurrentTags();
          } else if (input.value.trim() === '') {
            popup_element.remove();
            popup_element = null;
          }
        }
        break;
      
      case 'Escape':
        dropdownContainer.style.display = 'none';
        selectedIndex = -1;
        filteredTags = [];
        break;
    }
  });

  // Handle clicks on dropdown items
  dropdownContainer.addEventListener('click', async (e) => {
    const item = e.target.closest('.ARCHIVEBOX__autocomplete-item');
    if (!item) return;

    const selectedTag = item.dataset.tag;
    const { current_entry, entries } = await getCurrentEntry();
    
    if (!current_entry.tags.includes(selectedTag)) {
      current_entry.tags.push(selectedTag);
      await chrome.storage.sync.set({ entries });
      await updateCurrentTags();
      await updateSuggestions();
    }
    
    input.value = '';
    dropdownContainer.style.display = 'none';
    selectedIndex = -1;
    filteredTags = [];
    input.focus();
  });

  // Hide dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!popup_element?.contains(e.target)) {
      dropdownContainer.style.display = 'none';
      selectedIndex = -1;
      filteredTags = [];
    }
  });

  // Add escape key handler
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && popup_element) {
      popup_element.remove();
      popup_element = null;
    }
  });
  
  input.focus();
  console.log('+ Showed ArchiveBox popup');
}

window.createPopup();
