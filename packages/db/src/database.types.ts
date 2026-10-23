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
      projects: Table<{
        id: string;
        workspace_id: string;
        name: string;
        status: string;
        versioning_mode: string;
        revision: number;
        created_at: string;
      }>;
      albums: Table<{
        id: string;
        workspace_id: string;
        project_id: string;
        name: string;
        state: string;
        is_pinned: boolean;
        legal_hold: boolean;
        published_at: string | null;
        last_valid_viewed_at: string | null;
        revision: number;
        created_at: string;
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
      begin_oauth_link: {
        Args: {
          p_provider: string;
          p_token_hash: string;
          p_request_id: string;
        };
        Returns: Json;
      };
      read_oauth_link: { Args: { p_token_hash: string }; Returns: Json };
      complete_oauth_link: { Args: { p_token_hash: string }; Returns: Json };
      create_project: {
        Args: { p_workspace_id: string; p_name: string; p_request_id: string };
        Returns: Json;
      };
      rename_project: {
        Args: {
          p_project_id: string;
          p_name: string;
          p_expected_revision: number;
          p_request_id: string;
        };
        Returns: Json;
      };
      create_album: {
        Args: { p_project_id: string; p_name: string; p_request_id: string };
        Returns: Json;
      };
      set_album_protection: {
        Args: {
          p_album_id: string;
          p_is_pinned: boolean;
          p_legal_hold: boolean;
          p_expected_revision: number;
          p_confirm_unprotect: boolean;
          p_request_id: string;
        };
        Returns: Json;
      };
      rename_album: {
        Args: {
          p_album_id: string;
          p_name: string;
          p_expected_revision: number;
          p_request_id: string;
        };
        Returns: Json;
      };
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
