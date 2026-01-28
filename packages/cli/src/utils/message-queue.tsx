import React from 'react';
import ErrorMessage from '@/components/error-message';
import InfoMessage from '@/components/info-message';
import SuccessMessage from '@/components/success-message';
import WarningMessage from '@/components/warning-message';
import type { MessageType } from '@/types/index';

// Global message queue function - will be set by App component
let globalAddToChatQueue: ((component: React.ReactNode) => void) | null = null;
let componentKeyCounter = 0;

// Set the global chat queue function
export function setGlobalMessageQueue(
	addToChatQueue: (component: React.ReactNode) => void,
) {
	globalAddToChatQueue = addToChatQueue;
}

// Helper function to generate stable keys
function getNextKey(): string {
	componentKeyCounter++;
	return `global-msg-${componentKeyCounter}`;
}

// Add message to chat queue
function addMessageToQueue(
	type: MessageType,
	message: string,
	hideBox: boolean = true,
) {
	if (!globalAddToChatQueue) {
		// Fallback to console if queue not available
		console[type === 'error' ? 'error' : 'log'](message);
		return;
	}

	const key = getNextKey();
	let component: React.ReactNode;

	switch (type) {
		case 'error':
			component = (
				<ErrorMessage key={key} message={message} hideBox={hideBox} />
			);
			break;
		case 'success':
			component = (
				<SuccessMessage key={key} message={message} hideBox={hideBox} />
			);
			break;
		case 'warning':
			component = (
				<WarningMessage key={key} message={message} hideBox={hideBox} />
			);
			break;
		case 'info':
		default:
			component = <InfoMessage key={key} message={message} hideBox={hideBox} />;
			break;
	}

	globalAddToChatQueue(component);
}

// Convenience functions for each message type
export function logInfo(message: string, hideBox: boolean = true) {
	addMessageToQueue('info', message, hideBox);
}

export function logError(message: string, hideBox: boolean = true) {
	addMessageToQueue('error', message, hideBox);
}

// Temporarily ingored in `knip.json`. We do want this. We just haven't used it yet.
export function logSuccess(message: string, hideBox: boolean = true) {
	addMessageToQueue('success', message, hideBox);
}

export function logWarning(message: string, hideBox: boolean = true) {
	addMessageToQueue('warning', message, hideBox);
}
