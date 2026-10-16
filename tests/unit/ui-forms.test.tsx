import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Checkbox } from '@/components/ui/checkbox';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldTitle,
} from '@/components/ui/field';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from '@/components/ui/input-group';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemHeader,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from '@/components/ui/item';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';

const slot = (container: HTMLElement, name: string) =>
  container.querySelector(`[data-slot="${name}"]`);

describe('Field', () => {
  it('renders field structure and orientations', () => {
    const { container } = render(
      <FieldSet>
        <FieldLegend variant="label">Profile</FieldLegend>
        <FieldGroup>
          <Field orientation="horizontal">
            <FieldLabel htmlFor="n">Name</FieldLabel>
            <FieldContent>
              <FieldTitle>Title</FieldTitle>
              <FieldDescription>Help</FieldDescription>
            </FieldContent>
          </Field>
          <FieldSeparator />
          <FieldSeparator>or</FieldSeparator>
          <Field />
        </FieldGroup>
      </FieldSet>,
    );
    expect(slot(container, 'field-legend')?.getAttribute('data-variant')).toBe('label');
    const fields = container.querySelectorAll('[data-slot="field"]');
    expect(fields[0]?.getAttribute('data-orientation')).toBe('horizontal');
    expect(fields[1]?.getAttribute('data-orientation')).toBe('vertical');
    const separators = container.querySelectorAll('[data-slot="field-separator"]');
    expect(separators[0]?.getAttribute('data-content')).toBe('false');
    expect(separators[1]?.getAttribute('data-content')).toBe('true');
    expect(screen.getByText('or').getAttribute('data-slot')).toBe('field-separator-content');
    render(<FieldLegend>Default</FieldLegend>);
    expect(screen.getByText('Default').getAttribute('data-variant')).toBe('legend');
  });

  it('renders FieldError from children, single, duplicate and multiple errors', () => {
    const { rerender, container } = render(<FieldError />);
    expect(screen.queryByRole('alert')).toBeNull();

    rerender(<FieldError errors={[]} />);
    expect(screen.queryByRole('alert')).toBeNull();

    rerender(<FieldError>Custom</FieldError>);
    expect(screen.getByRole('alert').textContent).toBe('Custom');

    rerender(<FieldError errors={[{ message: 'Required' }, { message: 'Required' }]} />);
    expect(screen.getByRole('alert').textContent).toBe('Required');

    rerender(<FieldError errors={[{ message: 'A' }, undefined, { message: 'B' }]} />);
    const items = container.querySelectorAll('li');
    expect(Array.from(items, (item) => item.textContent)).toEqual(['A', 'B']);

    rerender(<FieldError errors={[{}]} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('InputGroup', () => {
  it('focuses the input when clicking an addon, but not when clicking a button', async () => {
    const onButton = vi.fn();
    render(
      <InputGroup>
        <InputGroupInput aria-label="Search" />
        <InputGroupAddon>
          <InputGroupText>@</InputGroupText>
        </InputGroupAddon>
        <InputGroupAddon align="inline-end">
          <InputGroupButton size="icon-xs" aria-label="Go" onClick={onButton} />
        </InputGroupAddon>
      </InputGroup>,
    );
    const input = screen.getByRole('textbox', { name: 'Search' });
    await userEvent.click(screen.getByText('@'));
    expect(document.activeElement).toBe(input);
    (input as HTMLInputElement).blur();
    const button = screen.getByRole('button', { name: 'Go' });
    await userEvent.click(button);
    expect(onButton).toHaveBeenCalledOnce();
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('data-size')).toBe('icon-xs');
  });

  it('renders a textarea control and block addons', () => {
    const { container } = render(
      <InputGroup>
        <InputGroupTextarea aria-label="Body" />
        <InputGroupAddon align="block-end">
          <InputGroupButton>Send</InputGroupButton>
        </InputGroupAddon>
      </InputGroup>,
    );
    expect(screen.getByRole('textbox', { name: 'Body' }).tagName).toBe('TEXTAREA');
    expect(slot(container, 'input-group-addon')?.getAttribute('data-align')).toBe('block-end');
    expect(screen.getByRole('button', { name: 'Send' }).getAttribute('data-size')).toBe('xs');
  });
});

describe('Item', () => {
  it('renders all item slots and variants', () => {
    const { container } = render(
      <ItemGroup>
        <Item variant="outline" size="sm">
          <ItemHeader>Header</ItemHeader>
          <ItemMedia variant="icon">i</ItemMedia>
          <ItemContent>
            <ItemTitle>Title</ItemTitle>
            <ItemDescription>Desc</ItemDescription>
          </ItemContent>
          <ItemActions>Actions</ItemActions>
          <ItemFooter>Footer</ItemFooter>
        </Item>
        <ItemSeparator />
        <Item asChild>
          <a href="/i">Linked item</a>
        </Item>
        <ItemMedia />
      </ItemGroup>,
    );
    expect(screen.getByRole('list')).toBeTruthy();
    const item = slot(container, 'item');
    expect(item?.getAttribute('data-variant')).toBe('outline');
    expect(item?.getAttribute('data-size')).toBe('sm');
    expect(screen.getByRole('link', { name: 'Linked item' }).getAttribute('data-variant')).toBe(
      'default',
    );
    const media = container.querySelectorAll('[data-slot="item-media"]');
    expect(media[0]?.getAttribute('data-variant')).toBe('icon');
    expect(media[1]?.getAttribute('data-variant')).toBe('default');
    for (const name of ['item-header', 'item-footer', 'item-actions', 'item-title'])
      expect(slot(container, name)).toBeTruthy();
  });
});

describe('Checkbox, RadioGroup, Switch and Slider', () => {
  it('toggles a checkbox', async () => {
    const onChange = vi.fn();
    render(<Checkbox aria-label="Accept" onCheckedChange={onChange} />);
    const checkbox = screen.getByRole('checkbox', { name: 'Accept' });
    await userEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith(true);
    expect(checkbox.getAttribute('data-state')).toBe('checked');
  });

  it('selects a radio option', async () => {
    const onChange = vi.fn();
    render(
      <RadioGroup onValueChange={onChange} aria-label="Plan">
        <RadioGroupItem value="a" aria-label="A" />
        <RadioGroupItem value="b" aria-label="B" />
      </RadioGroup>,
    );
    await userEvent.click(screen.getByRole('radio', { name: 'B' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('toggles a switch with sizes', async () => {
    const onChange = vi.fn();
    render(
      <>
        <Switch aria-label="Small" size="sm" onCheckedChange={onChange} />
        <Switch aria-label="Default" />
      </>,
    );
    const small = screen.getByRole('switch', { name: 'Small' });
    expect(small.getAttribute('data-size')).toBe('sm');
    expect(screen.getByRole('switch', { name: 'Default' }).getAttribute('data-size')).toBe(
      'default',
    );
    await userEvent.click(small);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('renders one thumb per value', () => {
    const { container, rerender } = render(<Slider value={[20]} />);
    expect(container.querySelectorAll('[data-slot="slider-thumb"]').length).toBe(1);
    rerender(<Slider defaultValue={[10, 40]} />);
    expect(container.querySelectorAll('[data-slot="slider-thumb"]').length).toBe(2);
    rerender(<Slider min={5} max={50} />);
    expect(container.querySelectorAll('[data-slot="slider-thumb"]').length).toBe(2);
  });
});
