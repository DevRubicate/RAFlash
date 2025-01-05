function createDialog(title, message, buttons) {
    // Create dialog
    const dialog = document.createElement('dialog');

    // Apply inline styles
    Object.assign(dialog.style, {
        border: 'none',
        borderRadius: '8px',
        boxShadow: '0 4px 6px rgba(0, 0, 0, 0.2)',
        padding: '20px',
        maxWidth: '400px',
        textAlign: 'center',
    });

    // Create backdrop styling
    dialog.addEventListener('cancel', (event) => event.preventDefault());
    dialog.style.backdropFilter = 'blur(4px)';

    // Add content
    dialog.innerHTML = `<h1>${title}</h1><p>${message}</p>`;
    const buttonContainer = document.createElement('div');
    Object.assign(buttonContainer.style, {
        display: 'flex',
        justifyContent: 'center',
        gap: '10px',
        marginTop: '15px',
    });

    // Append buttons
    buttons.forEach(({
        label,
        style,
        callback
    }) => {
        const button = document.createElement('button');
        button.textContent = label;

        // Apply button styles
        Object.assign(button.style, {
            padding: '5px 15px',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            ...style,
        });

        // Attach event listener
        button.addEventListener('click', () => {
            dialog.close();
            dialog.remove();
            if (callback) callback();
        });

        buttonContainer.appendChild(button);
    });

    dialog.appendChild(buttonContainer);
    document.body.appendChild(dialog);

    return dialog;
}

function alertDialog(title, message) {
    return new Promise((resolve) => {
        const dialog = createDialog(title, message, [{
            label: 'OK',
            style: {
                backgroundColor: '#007BFF',
                color: 'white'
            },
            callback: resolve,
        }, ]);

        dialog.showModal();
    });
}

function confirmDialog(title, message) {
    return new Promise((resolve) => {
        const dialog = createDialog(title, message, [{
                label: 'Yes',
                style: {
                    backgroundColor: '#007BFF',
                    color: 'white'
                },
                callback: () => resolve(true),
            },
            {
                label: 'No',
                style: {
                    backgroundColor: '#f44336',
                    color: 'white'
                },
                callback: () => resolve(false),
            },
        ]);

        dialog.showModal();
    });
}

export {
    alertDialog,
    confirmDialog
};