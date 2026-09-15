import { describe, expect, test } from 'vitest'
import type { Violation } from './publishTypes'
import {
  PUBLISH_PLATFORMS,
  copiedWhat,
  copyButtonText,
  copyButtonTitle,
  isPublishPlatform,
  packageCopiedToast,
  platformLabel,
} from './publishPlatforms'

function finding(
  field: string,
  message: string,
  severity: Violation['severity'] = 'hard'
): Violation {
  return { field, rule: 'r', message, severity }
}

describe('the platform inventory', () => {
  test('YouTube comes first, then LinkedIn, X and Instagram', () => {
    expect(PUBLISH_PLATFORMS).toEqual(['youtube', 'linkedin', 'x', 'instagram'])
    expect(PUBLISH_PLATFORMS.map(platformLabel)).toEqual(['YouTube', 'LinkedIn', 'X', 'Instagram'])
  })

  test('isPublishPlatform only accepts the four values', () => {
    expect(isPublishPlatform('x')).toBe(true)
    expect(isPublishPlatform('tiktok')).toBe(false)
    expect(isPublishPlatform('')).toBe(false)
  })
})

describe('button text', () => {
  test('YouTube keeps "Copy upload package"; the others name the platform', () => {
    expect(copyButtonText('youtube')).toBe('Copy upload package')
    expect(copyButtonText('linkedin')).toBe('Copy for LinkedIn')
    expect(copyButtonText('x')).toBe('Copy for X')
    expect(copyButtonText('instagram')).toBe('Copy for Instagram')
  })

  test('every platform has a tooltip, and the non-YouTube ones say nothing is posted', () => {
    for (const platform of PUBLISH_PLATFORMS) expect(copyButtonTitle(platform)).not.toBe('')
    expect(copyButtonTitle('x')).toContain('clipboard')
  })
})

describe('copiedWhat', () => {
  test('names the package, with the language when one was picked', () => {
    expect(copiedWhat('youtube', null)).toBe('the upload package')
    expect(copiedWhat('youtube', 'Polish')).toBe('the Polish upload package')
    expect(copiedWhat('linkedin', null)).toBe('the LinkedIn post')
    expect(copiedWhat('instagram', 'German')).toBe('the German Instagram post')
  })
})

describe('packageCopiedToast', () => {
  test('a clean copy is the plain success toast', () => {
    expect(packageCopiedToast('x', [], 'the X post')).toEqual({
      message: 'Copied the X post',
      type: 'success',
    })
  })

  test('style findings alone still count as a clean copy', () => {
    const toast = packageCopiedToast('linkedin', [finding('package.linkedin', 'few', 'style')], 'w')
    expect(toast).toEqual({ message: 'Copied w', type: 'success' })
  })

  test('one hard finding: the count and its message', () => {
    const toast = packageCopiedToast(
      'x',
      [finding('package.x', 'the X post is 312 of 280 characters')],
      'the X post'
    )
    expect(toast).toEqual({
      message: 'Copied — 1 issue: the X post is 312 of 280 characters',
      type: 'info',
    })
  })

  test("the platform's own finding leads, ahead of the record's", () => {
    const toast = packageCopiedToast(
      'instagram',
      [
        finding('title', 'Title is too long'),
        finding('package.instagram', 'post too long', 'style'),
        finding('package.instagram', 'the Instagram caption is 2300 of 2200 characters'),
      ],
      'the Instagram post'
    )
    expect(toast.message).toBe(
      'Copied — 2 issues: the Instagram caption is 2300 of 2200 characters'
    )
  })

  test("with no platform finding the record's first hard finding is quoted", () => {
    const toast = packageCopiedToast('youtube', [finding('title', 'Title is too long')], 'w')
    expect(toast.message).toBe('Copied — 1 issue: Title is too long')
  })
})
