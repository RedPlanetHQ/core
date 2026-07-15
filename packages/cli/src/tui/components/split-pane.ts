import {visibleWidth, truncateToWidth} from '@earendil-works/pi-tui';
import type {Component} from '@earendil-works/pi-tui';
import chalk from 'chalk';

/**
 * Horizontal split container that renders {@link left} and {@link right} as
 * side-by-side columns. When {@link left} is null the right child gets the
 * full width (transparent no-op), which lets us leave the pane permanently in
 * the TUI tree and toggle the split on/off.
 *
 * The left column takes {@link leftFraction} of the total width (default 40%)
 * with a 3-column vertical separator (` │ `) between the two panels. Rows
 * with different heights are padded so the divider stays continuous.
 */
export class SplitPane implements Component {
	private leftFraction = 0.4;

	constructor(
		private right: Component,
		private left: Component | null = null,
	) {}

	setLeft(left: Component | null): void {
		this.left = left;
	}

	setLeftFraction(fraction: number): void {
		this.leftFraction = Math.max(0.2, Math.min(0.8, fraction));
	}

	hasLeft(): boolean {
		return this.left !== null;
	}

	render(width: number): string[] {
		if (!this.left) return this.right.render(width);

		const gap = 3; // ` │ `
		const leftWidth = Math.max(
			10,
			Math.floor(width * this.leftFraction) - Math.ceil(gap / 2),
		);
		const rightWidth = Math.max(10, width - leftWidth - gap);

		const leftLines = this.left.render(leftWidth);
		const rightLines = this.right.render(rightWidth);
		const rowCount = Math.max(leftLines.length, rightLines.length);

		const divider = chalk.dim(' │ ');
		const emptyLeft = ' '.repeat(leftWidth);
		const emptyRight = ' '.repeat(rightWidth);

		const out: string[] = [];
		for (let i = 0; i < rowCount; i++) {
			const l = leftLines[i] ?? emptyLeft;
			const r = rightLines[i] ?? emptyRight;
			const lPad = ' '.repeat(Math.max(0, leftWidth - visibleWidth(l)));
			const rPad = ' '.repeat(Math.max(0, rightWidth - visibleWidth(r)));
			out.push(
				truncateToWidth(l + lPad, leftWidth) +
					divider +
					truncateToWidth(r + rPad, rightWidth),
			);
		}
		return out;
	}

	invalidate(): void {
		this.left?.invalidate?.();
		this.right.invalidate?.();
	}
}
