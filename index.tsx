import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin from "@utils/types";
import { findByProps, findComponentByCodeLazy, findStore } from "@webpack";
import { UserStore } from "@webpack/common";
import Settings from "./settings";

const Button = findComponentByCodeLazy(".GREEN,positionKeyStemOverride:");

let enabled = false;
let originalSend: any = null;
let originalIsSpeaking: any = null;
let originalGetSpeakingFlags: any = null;
let hookInterval: any = null;
let styleElement: HTMLStyleElement | null = null;

function applyNoSpeakingStyle(active: boolean) {
    if (active) {
        if (!styleElement) {
            styleElement = document.createElement("style");
            styleElement.id = "vc-fakedeafen-no-speaking";
            styleElement.textContent = `
                /* Kompleksowe i całkowite ukrycie zielonej obwódki mówienia (wszystkie widoki) */
                [class*="avatarSpeaking"],
                [class*="borderSpeaking"],
                [class*="speaking"],
                [class*="voiceAvatar"][class*="speaking"],
                [class*="overlayAvatar"][class*="speaking"],
                [class*="tile_"] [class*="speaking"],
                [class*="speaking_"]:after,
                [class*="speaking_"]:before,
                [class*="avatarSpeaking"]:after,
                [class*="avatarSpeaking"]:before,
                svg[class*="speaking"],
                div[class*="speakingRing"] {
                    box-shadow: none !important;
                    border-color: transparent !important;
                    outline: none !important;
                    stroke: transparent !important;
                }
            `;
            document.head.appendChild(styleElement);
        }
    } else {
        if (styleElement) {
            styleElement.remove();
            styleElement = null;
        }
    }
}

function getSpeakingStore(): any {
    return findByProps("isSpeaking", "getSpeakingFlags") || findStore("SpeakingStore");
}

function hookSpeakingStore() {
    const store = getSpeakingStore();
    if (!store || store.__fakeDeafenHooked) return;

    originalIsSpeaking = store.isSpeaking;
    originalGetSpeakingFlags = store.getSpeakingFlags;

    store.isSpeaking = function (userId: string, ...args: any[]) {
        const myId = UserStore?.getCurrentUser?.()?.id;
        if (enabled && myId && userId === myId) {
            return false;
        }
        return originalIsSpeaking ? originalIsSpeaking.apply(this, [userId, ...args]) : false;
    };

    store.getSpeakingFlags = function (userId: string, ...args: any[]) {
        const myId = UserStore?.getCurrentUser?.()?.id;
        if (enabled && myId && userId === myId) {
            return 0;
        }
        return originalGetSpeakingFlags ? originalGetSpeakingFlags.apply(this, [userId, ...args]) : 0;
    };

    store.__fakeDeafenHooked = true;
}

function refresh_voice_state(enabled: boolean) {
    applyNoSpeakingStyle(enabled);

    const ChannelStore = findByProps("getChannel", "getDMFromUserId");
    const SelectedChannelStore = findByProps("getVoiceChannelId");
    const wsModule = findByProps("getSocket");
    const MediaEngineStore = findByProps("isDeaf", "isMute");

    if (!wsModule || !SelectedChannelStore) return;
    
    const socket = wsModule.getSocket?.();
    const channelId = SelectedChannelStore.getVoiceChannelId?.();
    const channel = channelId ? ChannelStore?.getChannel?.(channelId) : null;
    const guildId = channel?.guild_id ?? (channel as any)?.getGuildId?.() ?? null;
    
    if (socket && channelId) {
        try {
            socket.send(4, {
                guild_id: guildId,
                channel_id: channelId,
                self_mute: (enabled && Settings.store.fakeMute) || (MediaEngineStore?.isMute?.() ?? false),
                self_deaf: (enabled && Settings.store.fakeDeafen) || (MediaEngineStore?.isDeaf?.() ?? false),
                self_video: false,
                flags: 0
            });
            console.log("[FakeDeafen] Voice state zaktualizowany pomyślnie.");
        } catch (error) {
            console.error("[FakeDeafen] Błąd aktualizacji voice state:", error);
        }
    }
}

function fd_icon() {
    const iconColor = enabled ? "#ed4245" : "currentColor";
    
    return (
        <svg width="20" height="20" viewBox="0 0 32 32" fill="none">
            <rect x="6" y="8" width="20" height="4" rx="2" fill={iconColor}/>
            <rect x="11" y="3" width="10" height="8" rx="3" fill={iconColor}/>
            {enabled ? (
                <>
                    <line x1="7" y1="18" x2="13" y2="24" stroke={iconColor} strokeWidth="2"/>
                    <line x1="13" y1="18" x2="7" y2="24" stroke={iconColor} strokeWidth="2"/>
                    <line x1="19" y1="18" x2="25" y2="24" stroke={iconColor} strokeWidth="2"/>
                    <line x1="25" y1="18" x2="19" y2="24" stroke={iconColor} strokeWidth="2"/>
                    <path d="M14 23c1-1 3-1 4 0" stroke={iconColor} strokeWidth="2" strokeLinecap="round"/>
                </>
            ) : (
                <>
                    <circle cx="10" cy="21" r="4" stroke={iconColor} strokeWidth="2" fill="none"/>
                    <circle cx="22" cy="21" r="4" stroke={iconColor} strokeWidth="2" fill="none"/>
                    <path d="M14 21c1 1 3 1 4 0" stroke={iconColor} strokeWidth="2" strokeLinecap="round"/>
                </>
            )}
        </svg>
    );
}

function toggleEnabled() {
    enabled = !enabled;
    refresh_voice_state(enabled);
}

function handleKeyDown(event: KeyboardEvent) {
    if (Settings.store.enableKeybind && event.ctrlKey && event.shiftKey && event.code === "KeyQ") {
        event.preventDefault();
        toggleEnabled();
    }
}

function fd_button(props: { nameplate?: any; }) {
    return (
        <Button
            tooltipText={enabled ? "Disable Fake Deafen" : "Enable Fake Deafen"}
            icon={fd_icon}
            role="switch"
            aria-checked={enabled}
            redGlow={enabled}
            plated={props?.nameplate != null}
            onClick={toggleEnabled}
        />
    );
}

function hookSocket() {
    const wsModule = findByProps("getSocket");
    if (!wsModule) return;
    const socket = wsModule.getSocket?.();
    if (!socket || socket.__fakeDeafenHooked) return;

    originalSend = socket.send;
    socket.send = function (op: number, data: any, ...args: any[]) {
        if (op === 4 && enabled && data) {
            if (Settings.store.fakeMute) data.self_mute = true;
            if (Settings.store.fakeDeafen) data.self_deaf = true;
        }
        return originalSend ? originalSend.apply(this, [op, data, ...args]) : undefined;
    };
    socket.__fakeDeafenHooked = true;
}

export default definePlugin({
    name: "FakeDeafen",
    description: "Fake deafen & silent mic indicator",
    authors: [{ name: "imigrancik", id: 0n }],
    settings: Settings,

    start() {
        hookSocket();
        hookSpeakingStore();
        hookInterval = setInterval(() => {
            hookSocket();
            hookSpeakingStore();
        }, 1500);
        window.addEventListener("keydown", handleKeyDown);
    },

    stop() {
        if (enabled) {
            enabled = false;
            refresh_voice_state(false);
        }
        applyNoSpeakingStyle(false);
        if (hookInterval) {
            clearInterval(hookInterval);
            hookInterval = null;
        }
        const wsModule = findByProps("getSocket");
        if (wsModule) {
            const socket = wsModule.getSocket?.();
            if (socket && originalSend) {
                socket.send = originalSend;
                delete socket.__fakeDeafenHooked;
            }
        }
        const store = getSpeakingStore();
        if (store) {
            if (originalIsSpeaking) store.isSpeaking = originalIsSpeaking;
            if (originalGetSpeakingFlags) store.getSpeakingFlags = originalGetSpeakingFlags;
            delete store.__fakeDeafenHooked;
        }
        window.removeEventListener("keydown", handleKeyDown);
    },

    patches: [
        {
            find: "#{intl::USER_PROFILE_ACCOUNT_POPOUT_BUTTON_A11Y_LABEL}",
            predicate: () => Settings.store.showButton,
            replacement: {
                match: /children:\[(?=.{0,25}?accountContainerRef)/,
                replace: "children:[$self.fd_button(arguments[0]),"
            }
        }
    ],

    fd_button: ErrorBoundary.wrap(fd_button, { noop: true }),
});
