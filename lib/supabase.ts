// Re-export client
export { supabase } from './supabase/client';

// Re-export all services
export { boardsService, boardStagesService } from './supabase/boards';
export { contactsService, companiesService } from './supabase/contacts';
export { dealsService } from './supabase/deals';
export { activitiesService } from './supabase/activities';
export { productsService } from './supabase/products';
export { settingsService, lifecycleStagesService } from './supabase/settings';
export { conversationsService } from './supabase/conversations';
export type { ConversationSummary } from './supabase/conversations';

// Re-export Realtime hooks
export { useRealtimeSync, useRealtimeSyncAll, useRealtimeSyncKanban } from './realtime';
