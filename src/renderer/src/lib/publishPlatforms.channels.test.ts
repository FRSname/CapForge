/**
 * The words around the footer's copy button once it copies a **channel's**
 * package: the label, the title and the toast after a copy.
 */

import { describe, expect, test } from 'vitest'
import type { Violation } from './publishTypes'
import {
  channelCopiedWhat,
  channelCopyText,
  channelCopyTitle,
  channelPackageCopiedToast,
} from './publishPlatforms'

function finding(field: string, message: string, severity: Violation['severity'] = 'hard') {
  return { field, rule: 'r', message, severity }
}

describe('the copy button', () => {
  test('names the platform and what it copies', () => {
    expect(channelCopyText('youtube')).toBe('Copy YouTube package')
    expect(channelCopyText('tiktok')).toBe('Copy TikTok caption')
    expect(channelCopyText('instagram')).toBe('Copy Instagram caption')
    expect(channelCopyText('linkedin')).toBe('Copy LinkedIn post')
    expect(channelCopyText('x')).toBe('Copy X post')
  })

  test('says nothing is posted, off YouTube', () => {
    expect(channelCopyTitle('youtube')).toContain('YouTube Studio')
    expect(channelCopyTitle('x')).toContain('nothing is posted')
  })

  test('the toast names the language only when one was chosen', () => {
    expect(channelCopiedWhat('youtube', null)).toBe('the YouTube package')
    expect(channelCopiedWhat('youtube', 'Polish')).toBe('the Polish YouTube package')
    expect(channelCopiedWhat('instagram', null)).toBe('the Instagram caption')
  })
})

describe('channelPackageCopiedToast', () => {
  test('style findings alone are still a clean copy', () => {
    expect(
      channelPackageCopiedToast('filip-ig', [finding('posts.filip-ig.hashtags', 'few', 'style')], 'w')
    ).toEqual({ message: 'Copied w', type: 'success' })
  })

  test('this channel’s own hard finding leads, ahead of the record’s', () => {
    const toast = channelPackageCopiedToast(
      'filip-ig',
      [
        finding('chapters', 'chapters must start at 00:00'),
        finding('posts.filip-ig.caption', 'the caption is 2300 of 2200 characters'),
      ],
      'the Instagram caption'
    )

    expect(toast).toEqual({
      message: 'Copied — 2 issues: the caption is 2300 of 2200 characters',
      type: 'info',
    })
  })
})
