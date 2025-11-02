(function () {
    const root = document.getElementById('miniwriter-app');
    if (!root) {
        return;
    }

    const STORAGE_PREFIX = 'miniwriter:draft:';
    const INDEX_KEY = 'miniwriter:index';
    const QUEUE_KEY = 'miniwriter:queue';

    const initial = parseState(root.dataset.miniwriter || '{}');
    const config = initial.config || {};
    const defaultPublished = config.default_published === true || config.default_published === 1 || config.default_published === '1';
    const route = config.route || '/miniwriter';

    const elements = {
        listSection: root.querySelector('[data-view="list"]'),
        editorSection: root.querySelector('[data-view="editor"]'),
        items: root.querySelector('[data-element="items"]'),
        empty: root.querySelector('[data-element="empty"]'),
        form: root.querySelector('[data-element="form"]'),
        editor: root.querySelector('[data-element="editor"]'),
        parentSelect: root.querySelector('select[name="parent_route"]'),
        toolbar: root.querySelector('[data-element="toolbar"]'),
        status: root.querySelector('[data-element="status"]'),
        history: root.querySelector('[data-element="history"]'),
        connection: root.querySelector('[data-state="connection"]'),
        syncAll: root.querySelector('[data-action="sync-all"]'),
        newButton: root.querySelector('[data-action="new"]'),
        cancelButton: root.querySelector('[data-action="cancel"]')
    };

    const state = {
        pages: initial.pages || [],
        parents: buildParents(initial.pages || []),
        current: null,
        queue: loadQueue(),
        autosaveTimer: null
    };

    setupTheme();
    setupToolbar();
    populateParents();
    renderList();
    updateConnectionBadge();
    flushQueue();

    elements.form.addEventListener('submit', onSubmit);
    elements.form.addEventListener('input', onInput);
    elements.editor.addEventListener('blur', saveDraftLocal);
    elements.newButton.addEventListener('click', () => openEditor(createNewDraft()));
    elements.cancelButton.addEventListener('click', () => switchToList());
    elements.syncAll.addEventListener('click', flushQueue);
    root.addEventListener('click', handleListClicks);
    elements.toolbar.addEventListener('click', onToolbarClick);

    window.addEventListener('online', () => {
        updateConnectionBadge();
        flushQueue();
    });
    window.addEventListener('offline', updateConnectionBadge);
    window.addEventListener('beforeunload', handleBeforeUnload);

    function parseState(value) {
        try {
            return JSON.parse(value);
        } catch (err) {
            return {};
        }
    }

    function setupTheme() {
        const theme = config.theme || 'auto';
        document.documentElement.setAttribute('data-mw-theme', theme);
        const fontSize = config.editor_font_size || 'medium';
        const wrapper = elements.editor.closest('.mw-textarea');
        if (wrapper) {
            wrapper.setAttribute('data-font-size', fontSize);
        }
    }

    function setupToolbar() {
        if (config.markdown_toolbar) {
            elements.toolbar.hidden = false;
            if (!config.allow_images) {
                const imageButton = elements.toolbar.querySelector('[data-role="image"]');
                if (imageButton) {
                    imageButton.disabled = true;
                }
            }
        }
    }

    function populateParents() {
        const select = elements.parentSelect;
        select.innerHTML = '';

        const options = new Map();
        options.set('/', 'Racine /');
        state.parents.forEach((title, route) => {
            if (!options.has(route)) {
                options.set(route, title);
            }
        });

        options.forEach((label, routeValue) => {
            const option = document.createElement('option');
            option.value = routeValue;
            option.textContent = label;
            select.appendChild(option);
        });
    }

    function buildParents(pages) {
        const parents = new Map();
        pages.forEach((page) => {
            parents.set(page.route, `${page.title || page.route} (${page.route})`);
            if (page.parent_route && !parents.has(page.parent_route)) {
                parents.set(page.parent_route, `${page.parent_route}`);
            }
        });
        return parents;
    }

    function createNewDraft() {
        const now = new Date().toISOString();
        const tempId = cryptoRandomId();
        return {
            id: tempId,
            temp_id: tempId,
            route: null,
            slug: null,
            parent_route: config.default_parent || '/',
            title: '',
            date: now,
            tags: [],
            published: defaultPublished,
            content: '',
            server_hash: null,
            local_updated_at: now,
            server_updated_at: null,
            dirty: true,
            is_new: true
        };
    }

    function renderList() {
        const template = document.getElementById('mw-list-item');
        elements.items.innerHTML = '';

        const displayItems = mergeItems();

        if (elements.syncAll) {
            elements.syncAll.disabled = state.queue.length === 0;
        }

        if (displayItems.length === 0) {
            elements.empty.hidden = false;
            return;
        }

        elements.empty.hidden = true;

        displayItems.forEach((item) => {
            const clone = template.content.firstElementChild.cloneNode(true);
            clone.dataset.id = item.id;
            clone.dataset.route = item.route || '';
            clone.querySelector('[data-field="title"]').textContent = item.title || 'Sans titre';
            clone.querySelector('[data-field="meta"]').textContent = item.meta.join(' • ');
            const editButton = clone.querySelector('[data-action="edit"]');
            editButton.disabled = !item.editable;
            elements.items.appendChild(clone);
        });
    }

    function mergeItems() {
        const items = [];
        const draftIndex = loadIndex();
        const draftMap = new Map();
        draftIndex.forEach((id) => {
            const draft = loadDraft(id);
            if (draft) {
                draftMap.set(id, draft);
            }
        });

        (state.pages || []).forEach((page) => {
            const draft = draftMap.get(page.route);
            items.push(toListItem(page, draft));
            if (draft) {
                draftMap.delete(page.route);
            }
        });

        draftMap.forEach((draft, id) => {
            items.push(toListItem(null, draft));
        });

        return items.sort((a, b) => b.sortKey.localeCompare(a.sortKey));
    }

    function toListItem(page, draft) {
        const meta = [];
        let sortKey = '0000';
        let title = 'Sans titre';
        let routeValue = null;
        let id = null;
        let editable = true;

        if (page) {
            title = page.title || title;
            routeValue = page.route;
            id = page.route;
            const status = page.published ? 'Publié' : 'Brouillon';
            meta.push(status);
            if (page.date) {
                meta.push(formatDate(page.date));
            }
            sortKey = page.updated_at || page.modified || page.date || sortKey;
        }

        if (draft) {
            title = draft.title || title;
            sortKey = draft.local_updated_at || sortKey;
            id = draft.id || draft.route || draft.temp_id;
            if (draft.dirty) {
                meta.push('Local non synchronisé');
            }
            if (!draft.route) {
                meta.push('Local uniquement');
                editable = true;
            }
        }

        if (!page && draft) {
            routeValue = draft.route || '';
            meta.unshift(draft.published ? 'Publié' : 'Brouillon');
        }

        return {
            id: id || routeValue || cryptoRandomId(),
            route: routeValue || null,
            title,
            meta,
            sortKey,
            editable
        };
    }

    function formatDate(value) {
        try {
            const date = new Date(value);
            return date.toLocaleString();
        } catch (err) {
            return value;
        }
    }

    function handleListClicks(event) {
        const action = event.target.getAttribute('data-action');
        if (action !== 'edit') {
            return;
        }
        const item = event.target.closest('.mw-list-item');
        if (!item) {
            return;
        }
        const route = item.dataset.route || null;
        const id = item.dataset.id;
        openEditorById(route || id);
    }

    function openEditorById(identifier) {
        const draft = loadDraft(identifier);
        if (draft && draft.route) {
            openEditor(draft);
            return;
        }
        if (draft && !draft.route) {
            openEditor(draft);
            return;
        }
        if (identifier && identifier.startsWith('/')) {
            fetchPage(identifier);
            return;
        }
        openEditor(createNewDraft());
    }

    function openEditor(draft) {
        state.current = normaliseDraft(draft);
        switchToEditor();
        fillForm(state.current);
        startAutosave();
        updateHistory();
        updateStatus('Mode édition');
        saveDraftLocal();
    }

    function normaliseDraft(draft) {
        draft = draft || createNewDraft();
        const now = new Date().toISOString();
        const defaults = {
            id: draft.route || draft.id || draft.temp_id || cryptoRandomId(),
            route: draft.route || null,
            slug: draft.slug || null,
            parent_route: draft.parent_route || config.default_parent || '/',
            title: draft.title || '',
            date: draft.date || now,
            tags: draft.tags || [],
            published: draft.published ?? defaultPublished,
            content: draft.content || '',
            server_hash: draft.server_hash || null,
            local_updated_at: draft.local_updated_at || null,
            server_updated_at: draft.server_updated_at || draft.updated_at || null,
            dirty: draft.dirty || false,
            temp_id: draft.temp_id || (draft.route ? null : cryptoRandomId()),
            is_new: draft.is_new ?? !draft.route
        };
        addToIndex(defaults.id);
        return defaults;
    }

    function fillForm(draft) {
        elements.form.reset();
        elements.form.elements.title.value = draft.title;
        elements.form.elements.date.value = toInputDate(draft.date);
        elements.form.elements.tags.value = Array.isArray(draft.tags) ? draft.tags.join(', ') : draft.tags || '';
        elements.form.elements.published.checked = Boolean(draft.published);
        elements.form.elements.parent_route.value = draft.parent_route || config.default_parent || '/';
        elements.editor.value = draft.content || '';
    }

    function toInputDate(value) {
        if (!value) {
            return '';
        }
        try {
            const date = new Date(value);
            const offset = date.getTimezoneOffset();
            const adjusted = new Date(date.getTime() - offset * 60 * 1000);
            return adjusted.toISOString().slice(0, 16);
        } catch (err) {
            return value;
        }
    }

    function startAutosave() {
        if (state.autosaveTimer) {
            clearInterval(state.autosaveTimer);
        }
        const interval = Math.max(3, Number(config.autosave_interval || 8));
        state.autosaveTimer = setInterval(saveDraftLocal, interval * 1000);
    }

    function onInput() {
        if (!state.current) {
            return;
        }
        state.current.title = elements.form.elements.title.value.trim();
        state.current.date = fromInputDate(elements.form.elements.date.value);
        state.current.tags = parseTags(elements.form.elements.tags.value);
        state.current.published = elements.form.elements.published.checked;
        state.current.parent_route = elements.form.elements.parent_route.value || config.default_parent || '/';
        state.current.content = elements.editor.value;
        state.current.dirty = true;
        state.current.local_updated_at = new Date().toISOString();
        saveDraftLocal();
        updateHistory();
    }

    function fromInputDate(value) {
        if (!value) {
            return new Date().toISOString();
        }
        try {
            const date = new Date(value);
            const offset = date.getTimezoneOffset();
            return new Date(date.getTime() + offset * 60 * 1000).toISOString();
        } catch (err) {
            return new Date().toISOString();
        }
    }

    function parseTags(value) {
        if (!value) {
            return [];
        }
        return value.split(',').map((tag) => tag.trim()).filter(Boolean);
    }

    function saveDraftLocal() {
        if (!state.current) {
            return;
        }
        const data = Object.assign({}, state.current);
        const id = data.route || data.id || data.temp_id;
        if (!id) {
            data.id = cryptoRandomId();
        }
        storeDraft(data);
        renderList();
    }

    function storeDraft(draft) {
        const id = draft.route || draft.id || draft.temp_id;
        if (!id) {
            return;
        }
        try {
            localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(draft));
        } catch (err) {
            console.warn('MiniWriter: impossible de stocker le brouillon', err);
        }
        addToIndex(id);
    }

    function loadDraft(id) {
        try {
            const value = localStorage.getItem(STORAGE_PREFIX + id);
            return value ? JSON.parse(value) : null;
        } catch (err) {
            return null;
        }
    }

    function removeDraft(id) {
        try {
            localStorage.removeItem(STORAGE_PREFIX + id);
        } catch (err) {
            // ignore
        }
        removeFromIndex(id);
    }

    function loadIndex() {
        try {
            const value = localStorage.getItem(INDEX_KEY);
            return value ? JSON.parse(value) : [];
        } catch (err) {
            return [];
        }
    }

    function addToIndex(id) {
        const index = loadIndex();
        if (!index.includes(id)) {
            index.push(id);
            try {
                localStorage.setItem(INDEX_KEY, JSON.stringify(index));
            } catch (err) {
                // ignore
            }
        }
    }

    function removeFromIndex(id) {
        const index = loadIndex();
        const next = index.filter((value) => value !== id);
        try {
            localStorage.setItem(INDEX_KEY, JSON.stringify(next));
        } catch (err) {
            // ignore
        }
    }

    function loadQueue() {
        try {
            const value = localStorage.getItem(QUEUE_KEY);
            return value ? JSON.parse(value) : [];
        } catch (err) {
            return [];
        }
    }

    function storeQueue() {
        try {
            localStorage.setItem(QUEUE_KEY, JSON.stringify(state.queue));
        } catch (err) {
            console.warn('MiniWriter: impossible de stocker la file', err);
        }
        renderList();
    }

    function enqueue(payload) {
        const draftId = payload.route || payload.id || payload.temp_id || cryptoRandomId();
        state.queue = state.queue.filter((entry) => entry.draftId !== draftId);
        state.queue.push({
            type: 'save',
            payload,
            draftId,
            timestamp: Date.now()
        });
        storeQueue();
        updateStatus('Sauvegardé localement. En attente de synchronisation.');
    }

    function onSubmit(event) {
        event.preventDefault();
        if (!state.current) {
            return;
        }
        const payload = buildPayload();
        if (!navigator.onLine) {
            enqueue(payload);
            state.current.dirty = true;
            state.current.local_updated_at = new Date().toISOString();
            storeDraft(state.current);
            switchToList();
            return;
        }
        sendSave(payload);
    }

    function buildPayload() {
        const draft = state.current;
        return {
            task: 'miniwriter.save',
            id: draft.id,
            route: draft.route,
            slug: draft.slug,
            parent_route: draft.parent_route,
            title: draft.title,
            date: draft.date,
            tags: draft.tags,
            published: draft.published,
            content: draft.content,
            server_hash: draft.server_hash,
            template: draft.template || 'item',
            force: false
        };
    }

    async function sendSave(payload) {
        try {
            const response = await request(payload.task, payload);
            if (response.status === 'ok') {
                handleServerSaveSuccess(response, payload);
                return;
            }
            if (response.status === 'conflict') {
                handleConflict(response, payload);
                return;
            }
            updateStatus(response.message || 'Erreur de sauvegarde');
        } catch (err) {
            enqueue(payload);
        }
    }

    function handleServerSaveSuccess(response, payload) {
        const previousId = payload.route || payload.id || payload.temp_id || state.current.id;
        const draft = state.current || loadDraft(previousId) || {};
        draft.route = response.route;
        draft.slug = response.slug;
        draft.parent_route = response.parent_route || draft.parent_route;
        draft.server_hash = response.server_hash;
        draft.title = response.title || draft.title;
        draft.dirty = false;
        draft.local_updated_at = new Date().toISOString();
        draft.server_updated_at = new Date().toISOString();
        storeDraft(draft);
        if (previousId && previousId !== draft.route) {
            removeDraft(previousId);
        }
        state.current = draft;
        refreshPages();
        updateStatus('Sauvegarde serveur réussie');
        switchToList();
    }

    function handleConflict(response, payload) {
        const choice = window.prompt('Conflit détecté. 1: Remplacer côté serveur, 2: Dupliquer, 3: Annuler', '1');
        if (!choice) {
            updateStatus('Conflit non résolu');
            return;
        }
        if (choice === '1') {
            payload.force = true;
            payload.server_hash = response.server_hash;
            sendSave(payload);
        } else if (choice === '2') {
            duplicatePage(payload.route || state.current.route, payload);
        } else {
            updateStatus('Sauvegarde annulée');
        }
    }

    async function duplicatePage(routeValue, payload) {
        if (!routeValue) {
            updateStatus('Duplication impossible');
            return;
        }
        try {
            const result = await request('miniwriter.duplicate', { route: routeValue });
            if (result.status === 'ok') {
                updateStatus('Copie créée');
                refreshPages();
                openEditorById(result.route);
            } else {
                updateStatus(result.message || 'Duplication impossible');
            }
        } catch (err) {
            updateStatus('Erreur réseau lors de la duplication');
            enqueue(payload);
        }
    }

    async function fetchPage(routeValue) {
        try {
            const result = await request('miniwriter.page', { route: routeValue });
            if (result.status === 'ok') {
                const page = result.page;
                const draft = Object.assign({}, page, {
                    id: page.route,
                    tags: page.tags || [],
                    dirty: false,
                    local_updated_at: page.updated_at || null,
                    server_updated_at: page.updated_at || page.date,
                    is_new: false
                });
                storeDraft(draft);
                openEditor(draft);
            } else {
                updateStatus(result.message || 'Page inaccessible');
            }
        } catch (err) {
            updateStatus('Impossible de récupérer la page');
        }
    }

    async function refreshPages() {
        try {
            const response = await request('miniwriter.list', {});
            if (response.status === 'ok') {
                state.pages = response.pages || [];
                state.parents = buildParents(state.pages);
                populateParents();
                renderList();
            }
        } catch (err) {
            // ignore
        }
    }

    function switchToList() {
        elements.listSection.hidden = false;
        elements.editorSection.hidden = true;
        if (state.autosaveTimer) {
            clearInterval(state.autosaveTimer);
            state.autosaveTimer = null;
        }
        renderList();
    }

    function switchToEditor() {
        elements.listSection.hidden = true;
        elements.editorSection.hidden = false;
    }

    function updateHistory() {
        if (!state.current) {
            return;
        }
        const local = state.current.local_updated_at ? formatDate(state.current.local_updated_at) : '—';
        const server = state.current.server_updated_at ? formatDate(state.current.server_updated_at) : '—';
        elements.history.querySelector('[data-field="local"]').textContent = local;
        elements.history.querySelector('[data-field="server"]').textContent = server;
    }

    function updateStatus(message) {
        elements.status.textContent = message;
        setTimeout(() => {
            if (elements.status.textContent === message) {
                elements.status.textContent = '';
            }
        }, 4000);
    }

    function onToolbarClick(event) {
        const markdown = event.target.getAttribute('data-markdown');
        if (!markdown) {
            return;
        }
        event.preventDefault();
        insertMarkdown(markdown);
    }

    function insertMarkdown(snippet) {
        const textarea = elements.editor;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const value = textarea.value;
        textarea.value = value.slice(0, start) + snippet + value.slice(end);
        textarea.focus();
        const cursor = start + snippet.length;
        textarea.setSelectionRange(cursor, cursor);
        onInput();
    }

    function updateConnectionBadge() {
        if (!elements.connection) {
            return;
        }
        const status = navigator.onLine ? 'online' : 'offline';
        elements.connection.dataset.status = status;
    }

    async function flushQueue() {
        updateConnectionBadge();
        if (!navigator.onLine) {
            updateStatus('Hors ligne : envoi en attente');
            return;
        }
        if (!state.queue.length) {
            updateStatus('Tout est synchronisé');
            return;
        }
        const remaining = [];
        for (const entry of state.queue) {
            if (entry.type !== 'save') {
                continue;
            }
            try {
                const response = await request('miniwriter.save', Object.assign({}, entry.payload));
                if (response.status === 'ok') {
                    const draft = loadDraft(entry.draftId) || {};
                    draft.route = response.route;
                    draft.title = response.title || draft.title;
                    draft.server_hash = response.server_hash;
                    draft.dirty = false;
                    draft.local_updated_at = new Date().toISOString();
                    storeDraft(draft);
                    if (entry.draftId && entry.draftId !== draft.route) {
                        removeDraft(entry.draftId);
                    }
                    continue;
                }
                if (response.status === 'conflict') {
                    remaining.push(entry);
                    updateStatus('Conflit détecté lors de la synchronisation');
                    break;
                }
                remaining.push(entry);
            } catch (err) {
                remaining.push(entry);
                break;
            }
        }
        state.queue = remaining;
        storeQueue();
        refreshPages();
    }

    function handleBeforeUnload(event) {
        const unsynced = state.queue.length > 0 || hasDirtyDrafts();
        if (!unsynced) {
            return;
        }
        event.preventDefault();
        event.returnValue = '';
    }

    function hasDirtyDrafts() {
        const index = loadIndex();
        return index.some((id) => {
            const draft = loadDraft(id);
            return draft && draft.dirty;
        });
    }

    function request(task, payload) {
        const body = Object.assign({}, payload, { task });
        return fetch(route, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            credentials: 'same-origin',
            body: JSON.stringify(body)
        }).then((response) => {
            if (!response.ok) {
                throw new Error('HTTP error');
            }
            return response.json();
        });
    }

    function cryptoRandomId() {
        if (window.crypto && window.crypto.randomUUID) {
            return window.crypto.randomUUID();
        }
        return 'id-' + Math.random().toString(36).slice(2, 10);
    }

})();
