// Buttons that let the player pick an archive, level files, or a whole folder.

import { useEffect, useRef } from 'react';
import { FileIcon, FolderIcon } from '../ui/icons';

interface Props {
    disabled?: boolean;
    onPick(files: File[], fromFolder: boolean): void;
    fileLabel?: string;
    folderLabel?: string;
}

export function FilePicker({ disabled, onPick, fileLabel = 'Choose a file…', folderLabel = 'Choose a folder…' }: Props) {
    const fileInput = useRef<HTMLInputElement>(null);
    const folderInput = useRef<HTMLInputElement>(null);

    useEffect(() => {
        folderInput.current?.setAttribute('webkitdirectory', '');
    }, []);

    return (
        <div className="picker">
            <button className="button" disabled={disabled} onClick={() => fileInput.current?.click()}>
                <FileIcon />
                {fileLabel}
            </button>
            <button className="button" disabled={disabled} onClick={() => folderInput.current?.click()}>
                <FolderIcon />
                {folderLabel}
            </button>
            <input
                ref={fileInput}
                type="file"
                hidden
                accept=".zip,.tar,.gz,.tgz,.phd,.tub,.tr2,.tr4"
                onChange={(event) => {
                    const files = [...(event.target.files ?? [])];
                    event.target.value = '';
                    if (files.length > 0) onPick(files, false);
                }}
            />
            <input
                ref={folderInput}
                type="file"
                hidden
                multiple
                onChange={(event) => {
                    const files = [...(event.target.files ?? [])];
                    event.target.value = '';
                    if (files.length > 0) onPick(files, true);
                }}
            />
        </div>
    );
}
