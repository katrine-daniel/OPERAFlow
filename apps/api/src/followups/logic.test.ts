import { describe, expect, it } from 'vitest';
import {
  classifyMessage,
  isWithinBusinessHours,
  nextBusinessInstant,
  nextFollowUpAt,
  renderTemplate,
  replySubject,
  safeRecipients,
  templateProblems,
  type ThreadMessage,
} from './logic';

const ctx = { mailbox: 'res@agency.com', internalDomains: ['agency.com'], recipients: ['rates@hotelgroup.com'], originalMessageId: 'm0' };
const msg = (over: Partial<ThreadMessage>): ThreadMessage => ({ id: 'mX', from: 'x@y.com', to: [], cc: [], subject: 'RE: Rates Dec', date: new Date(), headers: {}, ...over });

describe('classifyMessage', () => {
  it('recognises the original and our own follow-ups', () => {
    expect(classifyMessage(msg({ id: 'm0', from: 'res@agency.com' }), ctx)).toBe('ORIGINAL');
    expect(classifyMessage(msg({ from: 'Reservations <RES@agency.com>' }), ctx)).toBe('OWN_FOLLOW_UP');
  });
  it('counts a reply from the recipient or a colleague at the same supplier domain', () => {
    expect(classifyMessage(msg({ from: 'Rates Desk <rates@hotelgroup.com>' }), ctx)).toBe('QUALIFYING_REPLY');
    expect(classifyMessage(msg({ from: 'anna@hotelgroup.com' }), ctx)).toBe('QUALIFYING_REPLY');
  });
  it('never treats out-of-office or automatic replies as a real reply', () => {
    expect(classifyMessage(msg({ from: 'rates@hotelgroup.com', subject: 'Automatic reply: Rates Dec' }), ctx)).toBe('OUT_OF_OFFICE');
    expect(classifyMessage(msg({ from: 'rates@hotelgroup.com', subject: 'Out of Office' }), ctx)).toBe('OUT_OF_OFFICE');
    expect(classifyMessage(msg({ from: 'rates@hotelgroup.com', headers: { 'auto-submitted': 'auto-replied' } }), ctx)).toBe('AUTO_REPLY');
    expect(classifyMessage(msg({ from: 'rates@hotelgroup.com', headers: { precedence: 'bulk' } }), ctx)).toBe('AUTO_REPLY');
    expect(classifyMessage(msg({ from: 'rates@hotelgroup.com', headers: { 'x-autoreply': 'yes' } }), ctx)).toBe('AUTO_REPLY');
  });
  it('detects bounces', () => {
    expect(classifyMessage(msg({ from: 'MAILER-DAEMON@mx.hotelgroup.com', subject: 'Failure' }), ctx)).toBe('BOUNCE');
    expect(classifyMessage(msg({ from: 'postmaster@outlook.com', subject: 'Undeliverable: Rates Dec' }), ctx)).toBe('BOUNCE');
    expect(classifyMessage(msg({ from: 'x@y.com', headers: { 'content-type': 'multipart/report; report-type=delivery-status' } }), ctx)).toBe('BOUNCE');
  });
  it('keeps internal chatter from stopping the timer and escalates unknown senders', () => {
    expect(classifyMessage(msg({ from: 'boss@agency.com' }), ctx)).toBe('INTERNAL');
    expect(classifyMessage(msg({ from: 'someone@unrelated.org' }), ctx)).toBe('AMBIGUOUS');
  });
  it('does not treat other users of a free-mail domain as the supplier', () => {
    const c = { ...ctx, recipients: ['smallhotel@gmail.com'] };
    expect(classifyMessage(msg({ from: 'stranger@gmail.com' }), c)).toBe('AMBIGUOUS');
    expect(classifyMessage(msg({ from: 'smallhotel@gmail.com' }), c)).toBe('QUALIFYING_REPLY');
  });
});

const rule = { delayHours: 24, businessHoursOnly: true, businessStart: '09:00', businessEnd: '18:00', businessDays: [1, 2, 3, 4, 5], timezone: 'Asia/Dubai' };

describe('business-hours scheduling', () => {
  it('adds the delay and keeps it when already inside business hours', () => {
    // Tue 10:00 Dubai (06:00Z) + 24h = Wed 10:00 Dubai
    expect(nextFollowUpAt(new Date('2026-11-10T06:00:00Z'), rule).toISOString()).toBe('2026-11-11T06:00:00.000Z');
  });
  it('moves to the next business morning when due after hours', () => {
    // Tue 19:30 Dubai + 24h = Wed 19:30 → Thu 09:00 Dubai (05:00Z)
    expect(nextFollowUpAt(new Date('2026-11-10T15:30:00Z'), rule).toISOString()).toBe('2026-11-12T05:00:00.000Z');
  });
  it('skips weekends', () => {
    // Fri 11:00 Dubai + 24h = Sat 11:00 → Mon 09:00 Dubai
    expect(nextFollowUpAt(new Date('2026-11-13T07:00:00Z'), rule).toISOString()).toBe('2026-11-16T05:00:00.000Z');
  });
  it('waits until opening time on an early morning', () => {
    expect(nextBusinessInstant(new Date('2026-11-16T02:00:00Z'), rule).toISOString()).toBe('2026-11-16T05:00:00.000Z');
    expect(isWithinBusinessHours(new Date('2026-11-16T06:00:00Z'), rule)).toBe(true);
    expect(isWithinBusinessHours(new Date('2026-11-15T06:00:00Z'), rule)).toBe(false); // Sunday
  });
  it('ignores the window when business hours are off', () => {
    const at = new Date('2026-11-14T22:00:00Z');
    expect(nextFollowUpAt(at, { ...rule, businessHoursOnly: false, delayHours: 48 }).toISOString()).toBe('2026-11-16T22:00:00.000Z');
  });
});

describe('templates and recipients', () => {
  it('renders known placeholders and reports unknown ones', () => {
    expect(templateProblems('Hi {{supplierName}}, {{oops}}')).toEqual(['Unknown placeholder {{oops}}']);
    expect(renderTemplate('Dear {{ supplierName }}, re {{originalSubject}}', { supplierName: 'Hotel A', originalSubject: 'Rates', originalSentDate: '', ownerName: '', followUpNumber: '1' })).toBe('Dear Hotel A, re Rates');
    expect(replySubject('Rates Dec')).toBe('RE: Rates Dec');
    expect(replySubject('Re: Rates Dec')).toBe('Re: Rates Dec');
  });
  it('only targets original recipients who are approved supplier contacts', () => {
    expect(safeRecipients(['Rates@Hotel.com', 'cc-colleague@agency.com', 'other@hotel.com'], ['rates@hotel.com'])).toEqual(['rates@hotel.com']);
    expect(safeRecipients(['someone@else.com'], ['rates@hotel.com'])).toEqual([]);
  });
});
