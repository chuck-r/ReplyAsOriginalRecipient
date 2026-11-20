// https://webextension-api.thunderbird.net/en/mv3/tabs.html#tab

type ThunderbirdAPI = {
	tabs: TabsAPI;
	windows: WindowAPI;
	compose: ComposeAPI;
	messages: MessageAPI;
};

type MessageAPI = {
	getFull(messageId: MessageId, options?: unknown): Promise<MessagePart>;
};

type ComposeAPI = {
	getComposeDetails(tabId: TabId): Promise<ComposeDetails>;
	setComposeDetails(tabId: TabId, details: ComposeDetails): Promise<void>;
};

type TabsAPI = {
	onCreated: Listener<[tab: Tab]>;
	onUpdated: Listener<[tab_id: TabId, changeInfo: ChangeInfo, tab: Tab]>;
	query(queryInfo: { windowId?: WindowId }): Promise<Tab[]>;
	executeScript(tabid: TabId, inject: { code: string }): Promise<void>; // Manifest v2
};

type WindowAPI = {
	onCreated: Listener<[win: TWindow]>;
	get(windowId: WindowId): Promise<TWindow>;
};

type Listener<T extends unknown[]> = {
	addListener(listener: (...params: T) => void): void;
};

type ChangeInfo = {
	favIconUrl?: string;
	status?: Status;
	url?: string;
}

type Tab = {
	id?: TabId;
	windowId?: WindowId;
	url?: string;
	status?: Status;
};

type TWindow = {
	id?: WindowId;
	type?: WindowType;
};

type ComposeDetails = {
	to?: ComposeRecipientList;
	cc?: ComposeRecipientList;
	bcc?: ComposeRecipientList;
	from?: ComposeRecipient;
	subject?: string;
	readonly type?: "draft" | "forward" | "new" | "redirect" | "reply";
	relatedMessageId?: MessageId;
};

type ComposeRecipient = {
	nodeId: string;
	type: "contact" | "mailingList";
} | string;

type MessagePart = {
	headers: HeadersDictionary;
};

type Mailbox = { name: string, email: string };
type ComposeRecipientList = ComposeRecipient[];

type LogType = "log" | "debug" | "warn" | "error";
type Status = "loading" | "complete";
type WindowType = "messageCompose" | "messageDisplay" | "normal" | "popup";
type WindowId = Branded<number, "WindowId">;
type TabId = Branded<number, "TabId">;
type MessageId = Branded<number, "MessageId">;
type HeadersDictionary = Branded<Record<string, string>, "HeadersDictionary">;

type Console = {
	debug: ConsoleFunction;
	log: ConsoleFunction;
	warn: ConsoleFunction;
	error: ConsoleFunction;
};

type ConsoleFunction = (...args: unknown[]) => void;

declare var messenger: ThunderbirdAPI;
declare var console: Console;
declare function setTimeout(call: () => void, timeout: number): number;

/* utility */
declare const __brand: unique symbol;
type Brand<B> = { [__brand]: B };
type Branded<T, B> = T & Brand<B>;