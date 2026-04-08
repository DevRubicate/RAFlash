interface DialogButton {
    label: string;
    style?: Partial<CSSStyleDeclaration>;
    callback?: () => void;
}

function createDialog(title: string, message: string, buttons: DialogButton[]): HTMLDialogElement {
    // Create dialog
    const dialog = document.createElement('dialog');

    // Apply inline styles
    Object.assign(dialog.style, {
        border: 'none',
        borderRadius: '10px',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.15), 0 2px 8px rgba(0, 0, 0, 0.08)',
        padding: '24px 28px',
        maxWidth: '380px',
        textAlign: 'center',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        color: '#1c1917',
    });

    // Create backdrop styling
    dialog.addEventListener('cancel', (event) => event.preventDefault());
    dialog.style.backdropFilter = 'blur(4px)';

    // Add content
    const h1 = document.createElement('h1');
    h1.textContent = title;
    Object.assign(h1.style, {
        fontSize: '1rem',
        fontWeight: '650',
        margin: '0 0 6px 0',
        color: '#1c1917',
    });
    const p = document.createElement('p');
    p.textContent = message;
    Object.assign(p.style, {
        fontSize: '0.8125rem',
        color: '#57534e',
        margin: '0',
        lineHeight: '1.5',
    });
    dialog.appendChild(h1);
    dialog.appendChild(p);
    const buttonContainer = document.createElement('div');
    Object.assign(buttonContainer.style, {
        display: 'flex',
        justifyContent: 'center',
        gap: '8px',
        marginTop: '20px',
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
            padding: '6px 18px',
            border: '1px solid transparent',
            borderRadius: '6px',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: '0.8125rem',
            fontWeight: '550',
            transition: 'filter 150ms ease',
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

function alertDialog(title: string, message: string): Promise<void> {
    return new Promise((resolve) => {
        const dialog = createDialog(title, message, [{
            label: 'OK',
            style: {
                backgroundColor: '#6366f1',
                color: 'white'
            },
            callback: resolve,
        }, ]);

        dialog.showModal();
    });
}

function confirmDialog(title: string, message: string): Promise<boolean> {
    return new Promise((resolve) => {
        const dialog = createDialog(title, message, [{
                label: 'Yes',
                style: {
                    backgroundColor: '#6366f1',
                    color: 'white'
                },
                callback: () => resolve(true),
            },
            {
                label: 'No',
                style: {
                    backgroundColor: '#ffffff',
                    color: '#1c1917',
                    borderColor: '#e5e4e2',
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
