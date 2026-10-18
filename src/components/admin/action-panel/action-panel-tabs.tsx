import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { AdminActionPanelProps } from '@/types/admin-action-panel';

import { ActionPanelBody } from './action-panel-body';

export function ActionPanelTabs({ tabs }: { tabs: NonNullable<AdminActionPanelProps['tabs']> }) {
  return (
    <Tabs
      value={tabs.value}
      onValueChange={tabs.onValueChange}
      className="min-h-none flex-1 gap-none overflow-hidden"
    >
      <TabsList
        className="mx-xl h-tabs-bar max-w-full shrink-0 justify-start overflow-x-auto"
        variant="line"
      >
        {tabs.items.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value} disabled={tab.disabled}>
            {tab.icon}
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      <ActionPanelBody>
        {tabs.items.map((tab) => (
          <TabsContent key={tab.value} value={tab.value} className="mt-none">
            {tab.content}
          </TabsContent>
        ))}
      </ActionPanelBody>
    </Tabs>
  );
}
