(function () {
    const state = {
        documents: [],
        activeDocumentId: null,
        isSending: false,
        isUploading: false,
    };

    const quickPrompts = [
        {
            title: 'Executive Summary',
            text: 'Give me a crisp executive summary of this document.',
        },
        {
            title: 'Key Points',
            text: 'List the most important points from this document.',
        },
        {
            title: 'Evidence Hunt',
            text: 'What evidence in the document supports the main argument?',
        },
        {
            title: 'Action Items',
            text: 'Extract action items, recommendations, or next steps from this document.',
        },
    ];

    const landingView = document.getElementById('landingView');
    const appView = document.getElementById('appView');
    const backHomeButton = document.getElementById('backHomeButton');
    const openAppButtons = document.querySelectorAll('[data-open-app]');

    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('fileInput');
    const uploadStatus = document.getElementById('uploadStatus');
    const messagesDiv = document.getElementById('messages');
    const queryInput = document.getElementById('queryInput');
    const sendButton = document.getElementById('sendButton');
    const clearChatButton = document.getElementById('clearChatButton');
    const promptGrid = document.getElementById('promptGrid');
    const documentList = document.getElementById('documentList');
    const activeDocumentLabel = document.getElementById('activeDocumentLabel');
    const composerMeta = document.getElementById('composerMeta');
    const refreshDocsButton = document.getElementById('refreshDocsButton');
    const refreshStatusButton = document.getElementById('refreshStatusButton');
    const clearDocsButton = document.getElementById('clearDocsButton');
    const landingProvider = document.getElementById('landingProvider');
    const landingDocuments = document.getElementById('landingDocuments');
    const landingChunks = document.getElementById('landingChunks');
    const statusProvider = document.getElementById('statusProvider');
    const statusDocuments = document.getElementById('statusDocuments');
    const statusChunks = document.getElementById('statusChunks');

    function setBusyState() {
        const uploadBusy = state.isUploading;
        const sendBusy = state.isSending;

        fileInput.disabled = uploadBusy;
        queryInput.disabled = sendBusy;
        sendButton.disabled = sendBusy;

        if (uploadBusy) {
            uploadArea.classList.add('is-busy');
        } else {
            uploadArea.classList.remove('is-busy');
        }
    }

    function renderView() {
        const appMode = window.location.hash === '#app';
        landingView.classList.toggle('hidden', appMode);
        appView.classList.toggle('hidden', !appMode);
        document.body.classList.toggle('app-mode', appMode);
        if (!appMode) {
            window.scrollTo({ top: 0, behavior: 'auto' });
        } else {
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }
    }

    async function parseJsonResponse(response) {
        const text = await response.text();
        if (!text) {
            return {};
        }

        try {
            return JSON.parse(text);
        } catch (_error) {
            throw new Error('Server returned an invalid response');
        }
    }

    function setUploadStatus(message, type = '') {
        uploadStatus.textContent = message;
        uploadStatus.className = type ? `upload-status ${type}` : 'upload-status';
    }

    function formatDate(isoString) {
        const date = new Date(isoString);
        return Number.isNaN(date.getTime()) ? isoString : date.toLocaleString();
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function updateComposerMeta() {
        const activeDoc = state.documents.find((doc) => doc.id === state.activeDocumentId);
        activeDocumentLabel.textContent = activeDoc ? activeDoc.filename : 'All indexed documents';

        composerMeta.textContent = activeDoc
            ? `Retrieval scope is locked to "${activeDoc.filename}".`
            : 'No active document selected. Queries run across all indexed documents.';
    }

    function renderPrompts() {
        promptGrid.innerHTML = quickPrompts.map((prompt) => `
            <button class="prompt-chip" type="button" data-prompt="${escapeHtml(prompt.text)}">
                <strong>${escapeHtml(prompt.title)}</strong>
                <span>${escapeHtml(prompt.text)}</span>
            </button>
        `).join('');

        promptGrid.querySelectorAll('[data-prompt]').forEach((button) => {
            button.addEventListener('click', () => {
                queryInput.value = button.getAttribute('data-prompt') || '';
                queryInput.focus();
            });
        });
    }

    function renderDocuments() {
        updateComposerMeta();

        if (!state.documents.length) {
            documentList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⌁</div><p>No indexed documents yet.</p></div>';
            return;
        }

        documentList.innerHTML = state.documents.map((doc) => `
            <div class="document-card ${doc.id === state.activeDocumentId ? 'active' : ''}" data-doc-id="${doc.id}">
                <div class="document-card-top">
                    <strong>${escapeHtml(doc.filename)}</strong>
                    <span class="document-chip">${escapeHtml(doc.sourceType)}</span>
                </div>
                <div class="document-meta">
                    ${doc.chunkCount} chunk${doc.chunkCount === 1 ? '' : 's'} · uploaded ${escapeHtml(formatDate(doc.uploadedAt))}
                </div>
                <div class="document-card-actions" style="margin-top: 12px;">
                    <button class="tiny-button" type="button" data-action="activate" data-doc-id="${doc.id}">
                        ${doc.id === state.activeDocumentId ? 'Active' : 'Set Active'}
                    </button>
                    <button class="tiny-button danger" type="button" data-action="delete" data-doc-id="${doc.id}">Delete</button>
                </div>
            </div>
        `).join('');

        documentList.querySelectorAll('[data-action="activate"]').forEach((button) => {
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                state.activeDocumentId = button.getAttribute('data-doc-id');
                renderDocuments();
            });
        });

        documentList.querySelectorAll('[data-action="delete"]').forEach((button) => {
            button.addEventListener('click', async (event) => {
                event.stopPropagation();
                const documentId = button.getAttribute('data-doc-id');
                if (!documentId) return;
                await deleteDocument(documentId);
            });
        });

        documentList.querySelectorAll('.document-card').forEach((card) => {
            card.addEventListener('click', () => {
                state.activeDocumentId = card.getAttribute('data-doc-id');
                renderDocuments();
            });
        });
    }

    function setStats(payload) {
        const provider = payload.provider || payload.modelProvider || '-';
        const documents = payload.documents ?? payload.activeDocuments ?? 0;
        const chunks = payload.totalChunks ?? 0;

        landingProvider.textContent = provider;
        landingDocuments.textContent = String(documents);
        landingChunks.textContent = String(chunks);
        statusProvider.textContent = provider;
        statusDocuments.textContent = String(documents);
        statusChunks.textContent = String(chunks);
    }

    async function loadStatus() {
        try {
            const [healthResponse, statusResponse] = await Promise.all([
                fetch('/api/health'),
                fetch('/api/status'),
            ]);

            const health = await parseJsonResponse(healthResponse);
            const status = await parseJsonResponse(statusResponse);

            if (healthResponse.ok) {
                setStats({
                    modelProvider: health.modelProvider,
                    activeDocuments: health.activeDocuments,
                    totalChunks: health.totalChunks,
                });
            }

            if (statusResponse.ok) {
                setStats(status);
            }
        } catch (_error) {
            setStats({ provider: 'offline', documents: 0, totalChunks: 0 });
        }
    }

    async function loadDocuments() {
        try {
            const response = await fetch('/api/documents');
            const data = await parseJsonResponse(response);

            if (!response.ok) {
                throw new Error(data.error || 'Failed to fetch documents');
            }

            state.documents = data.documents || [];
            if (state.activeDocumentId && !state.documents.some((doc) => doc.id === state.activeDocumentId)) {
                state.activeDocumentId = null;
            }
            if (!state.activeDocumentId && state.documents.length === 1) {
                state.activeDocumentId = state.documents[0].id;
            }
            renderDocuments();
        } catch (error) {
            documentList.innerHTML = `<div class="empty-state"><p>${escapeHtml(error.message)}</p></div>`;
        }
    }

    function ensureMessageFeedStarted() {
        const emptyState = messagesDiv.querySelector('.empty-state');
        if (emptyState) {
            emptyState.remove();
        }
    }

    function addMessage(role, content, options = {}) {
        ensureMessageFeedStarted();

        const message = document.createElement('div');
        message.className = `message ${role}`;

        const confidence = options.confidence
            ? `<div class="confidence-pill ${escapeHtml(options.confidence)}">${escapeHtml(options.confidence)} confidence</div>`
            : '';

        const sources = Array.isArray(options.sources) && options.sources.length
            ? `
                <div class="sources-grid">
                    ${options.sources.map((source, index) => `
                        <div class="source-card">
                            <div class="source-head">
                                <div class="source-title">${index + 1}. ${escapeHtml(source.filename)}${source.pageNumber ? ` · Page ${escapeHtml(String(source.pageNumber))}` : ''}</div>
                                <div class="source-score">${Math.round((source.score || 0) * 100)}% match</div>
                            </div>
                            <div class="source-excerpt">${escapeHtml(source.content)}</div>
                        </div>
                    `).join('')}
                </div>
            `
            : '';

        const messageMeta = options.meta
            ? `<div class="message-meta">${escapeHtml(options.meta)}</div>`
            : '';

        const actionRow = role === 'assistant' && !options.loading
            ? `<div class="document-card-actions" style="margin-top: 14px;"><button class="tiny-button" type="button" data-copy-answer>Copy Answer</button></div>`
            : '';

        message.innerHTML = `
            <div class="message-bubble">
                <div class="message-head">
                    <div class="message-meta">${role === 'user' ? 'Operator Query' : role === 'error' ? 'System Fault' : 'Assistant Output'}</div>
                </div>
                <div class="message-text">${options.loading ? content : escapeHtml(content)}</div>
                ${messageMeta}
                ${confidence}
                ${sources}
                ${actionRow}
            </div>
        `;

        messagesDiv.appendChild(message);

        const copyButton = message.querySelector('[data-copy-answer]');
        if (copyButton) {
            copyButton.addEventListener('click', async () => {
                await navigator.clipboard.writeText(content);
                copyButton.textContent = 'Copied';
                setTimeout(() => {
                    copyButton.textContent = 'Copy Answer';
                }, 1200);
            });
        }

        messagesDiv.scrollTop = messagesDiv.scrollHeight;
        return message;
    }

    async function handleFileUpload(file) {
        if (state.isUploading) return;
        if (!file) return;
        if (!/\.pdf$|\.txt$/i.test(file.name)) {
            setUploadStatus('Only PDF and TXT files are allowed.', 'error');
            return;
        }

        state.isUploading = true;
        setBusyState();
        setUploadStatus(`Uploading ${file.name}...`);

        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData,
            });
            const data = await parseJsonResponse(response);

            if (!response.ok) {
                throw new Error(data.error || 'Upload failed');
            }

            setUploadStatus(`Indexed "${data.document.filename}" with ${data.document.chunkCount} chunks.`, 'success');
            state.activeDocumentId = data.document.id;
            await Promise.all([loadDocuments(), loadStatus()]);
            addMessage('assistant', `Document "${data.document.filename}" is now indexed and ready.`, {
                meta: `Source type: ${data.document.sourceType.toUpperCase()} · Chunks: ${data.document.chunkCount}`,
            });
        } catch (error) {
            setUploadStatus(error.message, 'error');
            addMessage('error', error.message);
        } finally {
            state.isUploading = false;
            setBusyState();
            fileInput.value = '';
        }
    }

    async function sendMessage() {
        if (state.isSending) return;
        const query = queryInput.value.trim();
        if (!query) return;

        state.isSending = true;
        setBusyState();
        queryInput.value = '';
        addMessage('user', query, {
            meta: state.activeDocumentId ? 'Scoped to active document' : 'Querying all indexed documents',
        });

        const loadingMessage = addMessage('assistant', '<div class="loading-dots"><span></span><span></span><span></span></div>', {
            loading: true,
            meta: 'Retrieving context and generating grounded answer...',
        });

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    query,
                    documentId: state.activeDocumentId,
                }),
            });
            const data = await parseJsonResponse(response);
            loadingMessage.remove();

            if (!response.ok) {
                throw new Error(data.error || 'Query failed');
            }

            addMessage('assistant', data.answer, {
                confidence: data.confidence,
                sources: data.sources,
                meta: state.activeDocumentId ? 'Retrieved from active document scope' : 'Retrieved from full indexed corpus',
            });
        } catch (error) {
            loadingMessage.remove();
            addMessage('error', error.message);
        } finally {
            state.isSending = false;
            setBusyState();
            queryInput.focus();
        }
    }

    async function deleteDocument(documentId) {
        const documentToDelete = state.documents.find((doc) => doc.id === documentId);
        const confirmed = window.confirm(`Delete ${documentToDelete ? documentToDelete.filename : 'this document'} from the vector index?`);
        if (!confirmed) return;

        try {
            const response = await fetch(`/api/documents/${documentId}`, {
                method: 'DELETE',
            });
            const data = await parseJsonResponse(response);
            if (!response.ok) {
                throw new Error(data.error || 'Delete failed');
            }

            if (state.activeDocumentId === documentId) {
                state.activeDocumentId = null;
            }

            await Promise.all([loadDocuments(), loadStatus()]);
            addMessage('assistant', `Removed "${documentToDelete ? documentToDelete.filename : documentId}" from the index.`);
        } catch (error) {
            addMessage('error', error.message);
        }
    }

    async function clearAllDocuments() {
        const confirmed = window.confirm('Clear the entire indexed document collection?');
        if (!confirmed) return;

        try {
            const response = await fetch('/api/documents', {
                method: 'DELETE',
            });
            const data = await parseJsonResponse(response);
            if (!response.ok) {
                throw new Error(data.error || 'Clear failed');
            }

            state.activeDocumentId = null;
            state.documents = [];
            renderDocuments();
            await loadStatus();
            messagesDiv.innerHTML = '<div class="empty-state"><div class="empty-state-icon">◈</div><p>Collection cleared. Upload a new document to continue.</p></div>';
            addMessage('assistant', 'Vector collection cleared. Ready for a new indexing session.');
        } catch (error) {
            addMessage('error', error.message);
        }
    }

    uploadArea.addEventListener('click', (event) => {
        if (state.isUploading) {
            event.preventDefault();
            return;
        }

        if (event.target === fileInput) {
            return;
        }

        fileInput.click();
    });
    uploadArea.addEventListener('dragover', (event) => {
        event.preventDefault();
        uploadArea.classList.add('dragover');
    });
    uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
    uploadArea.addEventListener('drop', (event) => {
        event.preventDefault();
        uploadArea.classList.remove('dragover');
        if (event.dataTransfer.files.length > 0) {
            handleFileUpload(event.dataTransfer.files[0]);
        }
    });
    fileInput.addEventListener('change', (event) => {
        if (event.target.files.length > 0) {
            handleFileUpload(event.target.files[0]);
        }
    });

    queryInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendMessage();
        }
    });

    sendButton.addEventListener('click', sendMessage);
    clearChatButton.addEventListener('click', () => {
        messagesDiv.innerHTML = '<div class="empty-state"><div class="empty-state-icon">◈</div><p>Chat cleared. Ask another question whenever you are ready.</p></div>';
    });
    refreshDocsButton.addEventListener('click', loadDocuments);
    refreshStatusButton.addEventListener('click', loadStatus);
    clearDocsButton.addEventListener('click', clearAllDocuments);

    openAppButtons.forEach((button) => {
        button.addEventListener('click', () => {
            window.location.hash = 'app';
        });
    });

    backHomeButton.addEventListener('click', () => {
        history.replaceState(null, '', window.location.pathname + window.location.search);
        renderView();
    });

    window.addEventListener('hashchange', renderView);

    renderView();
    renderPrompts();
    renderDocuments();
    setBusyState();
    setUploadStatus('Processing limit: up to 90,000 extracted characters or 80 chunks per document.');
    loadDocuments();
    loadStatus();
})();
