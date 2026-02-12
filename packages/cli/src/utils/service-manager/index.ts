import { platform } from 'node:os';
import {
	installLaunchdService,
	uninstallLaunchdService,
	isLaunchdServiceInstalled,
	getLaunchdServiceStatus,
	startLaunchdService,
	stopLaunchdService,
	getLaunchdServicePid,
	LAUNCHD_SERVICE_NAME,
} from './launchd';
import {
	installSystemdService,
	uninstallSystemdService,
	isSystemdServiceInstalled,
	getSystemdServiceStatus,
	startSystemdService,
	stopSystemdService,
	getSystemdServicePid,
	SYSTEMD_SERVICE_NAME,
} from './systemd';

export type ServiceType = 'launchd' | 'systemd' | 'none';
export type ServiceStatus = 'running' | 'stopped' | 'not-installed';

export interface ServiceConfig {
	name: string;
	displayName: string;
	command: string;
	args: string[];
	port: number;
	workingDirectory: string;
	logPath: string;
	errorLogPath: string;
}

/**
 * Detect the appropriate service manager for the current platform
 */
export function getServiceType(): ServiceType {
	const os = platform();
	if (os === 'darwin') {
		return 'launchd';
	}
	if (os === 'linux') {
		return 'systemd';
	}
	return 'none';
}

/**
 * Get the service name for the current platform
 */
export function getServiceName(): string {
	const serviceType = getServiceType();
	switch (serviceType) {
		case 'launchd':
			return LAUNCHD_SERVICE_NAME;
		case 'systemd':
			return SYSTEMD_SERVICE_NAME;
		default:
			return 'corebrain-gateway';
	}
}

/**
 * Install the gateway as an OS-level service
 */
export async function installService(config: ServiceConfig): Promise<void> {
	const serviceType = getServiceType();

	switch (serviceType) {
		case 'launchd':
			await installLaunchdService(config);
			break;
		case 'systemd':
			await installSystemdService(config);
			break;
		case 'none':
			throw new Error(
				'Service installation is not supported on this platform. Only macOS (launchd) and Linux (systemd) are supported.',
			);
	}
}

/**
 * Uninstall the gateway OS-level service
 */
export async function uninstallService(name: string): Promise<void> {
	const serviceType = getServiceType();

	switch (serviceType) {
		case 'launchd':
			await uninstallLaunchdService(name);
			break;
		case 'systemd':
			await uninstallSystemdService(name);
			break;
		case 'none':
			throw new Error(
				'Service management is not supported on this platform.',
			);
	}
}

/**
 * Check if the gateway service is installed
 */
export async function isServiceInstalled(name: string): Promise<boolean> {
	const serviceType = getServiceType();

	switch (serviceType) {
		case 'launchd':
			return isLaunchdServiceInstalled(name);
		case 'systemd':
			return isSystemdServiceInstalled(name);
		case 'none':
			return false;
	}
}

/**
 * Get the current status of the gateway service
 */
export async function getServiceStatus(name: string): Promise<ServiceStatus> {
	const serviceType = getServiceType();

	switch (serviceType) {
		case 'launchd':
			return getLaunchdServiceStatus(name);
		case 'systemd':
			return getSystemdServiceStatus(name);
		case 'none':
			return 'not-installed';
	}
}

/**
 * Start the gateway service
 */
export async function startService(name: string): Promise<void> {
	const serviceType = getServiceType();

	switch (serviceType) {
		case 'launchd':
			await startLaunchdService(name);
			break;
		case 'systemd':
			await startSystemdService(name);
			break;
		case 'none':
			throw new Error(
				'Service management is not supported on this platform.',
			);
	}
}

/**
 * Stop the gateway service
 */
export async function stopService(name: string): Promise<void> {
	const serviceType = getServiceType();

	switch (serviceType) {
		case 'launchd':
			await stopLaunchdService(name);
			break;
		case 'systemd':
			await stopSystemdService(name);
			break;
		case 'none':
			throw new Error(
				'Service management is not supported on this platform.',
			);
	}
}

/**
 * Get the PID of the running gateway service
 */
export function getServicePid(name: string): number | null {
	const serviceType = getServiceType();

	switch (serviceType) {
		case 'launchd':
			return getLaunchdServicePid(name);
		case 'systemd':
			return getSystemdServicePid(name);
		case 'none':
			return null;
	}
}
