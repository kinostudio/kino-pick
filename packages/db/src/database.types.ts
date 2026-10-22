import type { Json } from '../../domain/src/index';
type Table<Row> = { Row: Row; Insert: never; Update: never; Relationships: [] };
export type Database = {
  public: {
    Tables: {
      workspaces: Table<{
        id: string;
        owner_user_id: string;
        name: string;
        quota_bytes: number;
        created_at: string;
        autodelete_enabled: boolean;
        retention_dry_run: boolean;
      }>;
      workspace_members: Table<{
        workspace_id: string;
        user_id: string;
        role: string;
        status: string;
      }>;
    };
    Views: Record<string, never>;
    Functions: {
      ensure_photographer_profile: {
        Args: { p_request_id: string };
        Returns: string;
      };
      create_workspace: {
        Args: { p_name: string; p_request_id: string };
        Returns: Json;
      };
      set_workspace_member: {
        Args: {
          p_workspace_id: string;
          p_user_id: string;
          p_role: string;
          p_status: string;
          p_request_id: string;
        };
        Returns: Json;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
