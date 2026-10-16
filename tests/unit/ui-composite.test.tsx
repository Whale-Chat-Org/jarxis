import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-themes', () => ({ useTheme: () => ({ theme: undefined }) }));

import { Calendar, CalendarDayButton } from '@/components/ui/calendar';
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxSeparator,
  ComboboxTrigger,
  ComboboxValue,
  useComboboxAnchor,
} from '@/components/ui/combobox';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller';
import { Toaster } from '@/components/ui/sonner';

describe('Calendar', () => {
  it('renders a month grid and selects a day', async () => {
    const onSelect = vi.fn();
    const { container } = render(
      <Calendar
        mode="single"
        month={new Date(2026, 0, 1)}
        onSelect={onSelect}
        showWeekNumber
        className="cal"
      />,
    );
    const root = container.querySelector('[data-slot="calendar"]') as HTMLElement;
    expect(root.className).toContain('cal');
    expect(screen.getByRole('grid')).toBeTruthy();
    // Navigation chevrons render left/right icons.
    expect(
      screen.getByRole('button', { name: /previous month/i }).querySelector('svg'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /next month/i }).querySelector('svg')).toBeTruthy();
    const day = container.querySelector('[data-day="1/15/2026"]') as HTMLElement;
    await userEvent.click(day);
    expect(onSelect).toHaveBeenCalled();
  });

  it('renders range modifiers and dropdown captions', () => {
    const { container } = render(
      <Calendar
        mode="range"
        captionLayout="dropdown"
        month={new Date(2026, 0, 1)}
        selected={{ from: new Date(2026, 0, 10), to: new Date(2026, 0, 12) }}
        buttonVariant="outline"
      />,
    );
    expect(container.querySelector('[data-range-start="true"]')).toBeTruthy();
    expect(container.querySelector('[data-range-middle="true"]')).toBeTruthy();
    expect(container.querySelector('[data-range-end="true"]')).toBeTruthy();
    // Dropdown caption uses the short month formatter and the down chevron.
    expect(screen.getAllByRole('combobox').length).toBeGreaterThan(0);
    expect(screen.getByRole('option', { name: 'Jan' })).toBeTruthy();
  });

  it('focuses a day button when focused', () => {
    const date = new Date(2026, 0, 5);
    render(
      <CalendarDayButton
        day={{ date } as never}
        modifiers={{ focused: true, selected: true } as never}
      >
        5
      </CalendarDayButton>,
    );
    const button = screen.getByRole('button', { name: '5' });
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('data-selected-single')).toBe('true');
  });
});

const fruits = ['Apple', 'Banana', 'Cherry'];

describe('Combobox', () => {
  it('opens, filters and selects an item', async () => {
    const onValueChange = vi.fn();
    render(
      <Combobox items={fruits} onValueChange={onValueChange}>
        <ComboboxInput placeholder="Fruit" showClear />
        <ComboboxContent>
          <ComboboxEmpty>No fruit</ComboboxEmpty>
          <ComboboxList>
            {(item: string) => (
              <ComboboxItem key={item} value={item}>
                {item}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>,
    );
    const input = screen.getByPlaceholderText('Fruit');
    await userEvent.click(input);
    await userEvent.type(input, 'Ban');
    const option = await screen.findByRole('option', { name: 'Banana' });
    await userEvent.click(option);
    expect(onValueChange).toHaveBeenCalledWith('Banana', expect.anything());
  });

  it('renders groups, labels, separators, collection and trigger', async () => {
    render(
      <Combobox items={[{ value: 'Fruits', items: fruits }]} defaultOpen>
        <ComboboxTrigger aria-label="Open list">
          <ComboboxValue placeholder="None" />
        </ComboboxTrigger>
        <ComboboxContent>
          <ComboboxList>
            {(group: { value: string; items: string[] }) => (
              <ComboboxGroup key={group.value} items={group.items}>
                <ComboboxLabel>{group.value}</ComboboxLabel>
                <ComboboxCollection>
                  {(item: string) => (
                    <ComboboxItem key={item} value={item}>
                      {item}
                    </ComboboxItem>
                  )}
                </ComboboxCollection>
                <ComboboxSeparator />
              </ComboboxGroup>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>,
    );
    expect(await screen.findByText('Fruits')).toBeTruthy();
    expect(screen.getAllByRole('option').length).toBe(3);
    expect(document.querySelector('[data-slot="combobox-separator"]')).toBeTruthy();
  });

  it('hides the trigger and disables the input', () => {
    render(
      <Combobox items={fruits}>
        <ComboboxInput placeholder="Disabled" disabled showTrigger={false} />
      </Combobox>,
    );
    expect((screen.getByPlaceholderText('Disabled') as HTMLInputElement).disabled).toBe(true);
    expect(document.querySelector('[data-slot="combobox-trigger"]')).toBeNull();
  });

  it('renders chips for multiple selection and removes one', async () => {
    function Chips() {
      const anchor = useComboboxAnchor();
      return (
        <Combobox items={fruits} multiple defaultValue={['Apple', 'Cherry']}>
          <ComboboxChips ref={anchor}>
            <ComboboxValue>
              {(values: string[]) =>
                values.map((value, index) => (
                  <ComboboxChip key={value} showRemove={index === 0}>
                    {value}
                  </ComboboxChip>
                ))
              }
            </ComboboxValue>
            <ComboboxChipsInput placeholder="Add" />
          </ComboboxChips>
          <ComboboxContent anchor={anchor}>
            <ComboboxList>
              {(item: string) => (
                <ComboboxItem key={item} value={item}>
                  {item}
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      );
    }
    render(<Chips />);
    const chips = document.querySelectorAll('[data-slot="combobox-chip"]');
    expect(chips.length).toBe(2);
    const remove = document.querySelector('[data-slot="combobox-chip-remove"]') as HTMLElement;
    expect(remove).toBeTruthy();
    expect(chips[1]?.querySelector('[data-slot="combobox-chip-remove"]')).toBeNull();
    await userEvent.click(remove);
    await waitFor(() =>
      expect(document.querySelectorAll('[data-slot="combobox-chip"]').length).toBe(1),
    );
  });
});

describe('MessageScroller', () => {
  it('renders the scroller structure and both scroll buttons', () => {
    const { container } = render(
      <MessageScrollerProvider>
        <MessageScroller className="scroller">
          <MessageScrollerViewport aria-label="Messages">
            <MessageScrollerContent>
              <MessageScrollerItem messageId="1">One</MessageScrollerItem>
              <MessageScrollerItem messageId="2" scrollAnchor>
                Two
              </MessageScrollerItem>
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
          <MessageScrollerButton direction="start" variant="outline" size="icon">
            Up
          </MessageScrollerButton>
        </MessageScroller>
      </MessageScrollerProvider>,
    );
    expect(container.querySelector('[data-slot="message-scroller"]')?.className).toContain(
      'scroller',
    );
    expect(screen.getByText('One')).toBeTruthy();
    const buttons = container.querySelectorAll('[data-slot="message-scroller-button"]');
    expect(buttons.length).toBe(2);
    expect(buttons[0]?.getAttribute('data-direction')).toBe('end');
    expect(buttons[0]?.textContent).toContain('Scroll to end');
    expect(buttons[1]?.getAttribute('data-direction')).toBe('start');
    expect(buttons[1]?.getAttribute('data-variant')).toBe('outline');
    expect(buttons[1]?.textContent).toBe('Up');
  });

  it('labels the start button when it has no children', () => {
    render(
      <MessageScrollerProvider>
        <MessageScroller>
          <MessageScrollerButton direction="start" />
        </MessageScroller>
      </MessageScrollerProvider>,
    );
    expect(screen.getByText('Scroll to start')).toBeTruthy();
  });
});

describe('Toaster', () => {
  it('renders the sonner region with the default system theme', () => {
    render(<Toaster />);
    expect(screen.getByLabelText(/Notifications/)).toBeTruthy();
  });
});
