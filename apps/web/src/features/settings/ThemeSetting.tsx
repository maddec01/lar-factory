// The board's light/dark preference in Settings › General › Preferences: the design system's Appearance row, the same
// row, words and place as lar-server's, with its three segments (Follow system, Light, Dark). It applies at once and is
// kept on this Mac.

import { AppearanceSetting } from '@lar-works/design-system';

import { useTheme } from '@/shared/preferences/Theme';

export function ThemeSetting({ id }: { id: string }) {
    const [theme, setTheme] = useTheme();

    return (
        <AppearanceSetting
            id={id}
            value={theme}
            onChange={setTheme}
            description="Follow the system, or always use light or dark."
        />
    );
}
