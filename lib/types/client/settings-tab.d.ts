import type { SessionHubNamespaceFace } from './face.ts';
/** The "Session Hub" tab inside Settings → Plugins. */
export declare function SessionHubSettingsTab(props: {
    hub: () => SessionHubNamespaceFace | undefined;
}): JSX.Element;
