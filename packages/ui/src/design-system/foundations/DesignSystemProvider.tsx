/* eslint-disable react-refresh/only-export-components -- Provider and consumer share the same UI label contract. */
import { createContext, type ReactNode, useContext } from 'react';

const defaultLabels = {
    close: 'Close',
    cancel: 'Cancel',
    retry: 'Try again',
    toolbar: 'Toolbar',
    imageSize: (width: number, height: number) => `${width} × ${height}`,
    folders: {
        path: 'Folder path',
        selectedPath: (path: string) => `Selected folder: ${path}`,
        open: (name: string) => `Open ${name}`,
        chooseFolder: 'Choose folder',
        title: 'Select a folder',
        root: 'Root',
        upOneLevel: 'Up one level',
        loading: 'Loading folders',
        loadFailed: 'Could not load folders',
        empty: 'No folders',
        loadMore: 'Load more',
        chooseThis: 'Choose this folder',
    },
};

export type DesignSystemLabels = typeof defaultLabels;

const LabelContext = createContext(defaultLabels);

export function DesignSystemProvider({ children, labels }: { children: ReactNode; labels: DesignSystemLabels }) {
    return <LabelContext.Provider value={labels}>{children}</LabelContext.Provider>;
}

export function useDesignSystemLabels() {
    return useContext(LabelContext);
}
