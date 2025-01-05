/**
 * RADisplay Hello World Tests
 *
 * Basic tests to verify the Vitest infrastructure works.
 */

import { test, expect } from 'vitest';

test('hello world - basic assertion', () => {
    expect(true).toBe(true);
});

test('hello world - math works', () => {
    expect(1 + 1).toBe(2);
});

test('hello world - strings', () => {
    expect('hello').toBe('hello');
});
