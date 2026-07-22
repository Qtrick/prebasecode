/* eslint-disable */
// GENERATED PLACEHOLDER — columns match supabase/migrations until CLI generation runs.
// Regenerate: npm run supabase:types (requires Supabase CLI + local stack).

export type Json =
	| string
	| number
	| boolean
	| null
	| { [key: string]: Json | undefined }
	| Json[];

export interface Database {
	public: {
		Tables: {
			profiles: {
				Row: {
					id: string;
					display_name: string | null;
					avatar_url: string | null;
					created_at: string;
					updated_at: string;
				};
				Insert: {
					id: string;
					display_name?: string | null;
					avatar_url?: string | null;
					created_at?: string;
					updated_at?: string;
				};
				Update: {
					id?: string;
					display_name?: string | null;
					avatar_url?: string | null;
					created_at?: string;
					updated_at?: string;
				};
				Relationships: [];
			};
			user_preferences: {
				Row: {
					user_id: string;
					preferences: Json;
					schema_version: number;
					updated_at: string;
				};
				Insert: {
					user_id: string;
					preferences?: Json;
					schema_version?: number;
					updated_at?: string;
				};
				Update: {
					user_id?: string;
					preferences?: Json;
					schema_version?: number;
					updated_at?: string;
				};
				Relationships: [];
			};
			agent_sessions: {
				Row: {
					id: string;
					user_id: string;
					title: string;
					default_model: string | null;
					default_mode: string | null;
					is_pinned: boolean;
					is_archived: boolean;
					created_at: string;
					updated_at: string;
				};
				Insert: {
					id?: string;
					user_id: string;
					title?: string;
					default_model?: string | null;
					default_mode?: string | null;
					is_pinned?: boolean;
					is_archived?: boolean;
					created_at?: string;
					updated_at?: string;
				};
				Update: {
					id?: string;
					user_id?: string;
					title?: string;
					default_model?: string | null;
					default_mode?: string | null;
					is_pinned?: boolean;
					is_archived?: boolean;
					created_at?: string;
					updated_at?: string;
				};
				Relationships: [];
			};
			agent_runs: {
				Row: {
					id: string;
					session_id: string;
					user_id: string;
					task_text: string;
					mode: string | null;
					model: string | null;
					status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
					verification_status: string | null;
					started_at: string | null;
					completed_at: string | null;
					error_summary: string | null;
					created_at: string;
					updated_at: string;
				};
				Insert: {
					id?: string;
					session_id: string;
					user_id: string;
					task_text?: string;
					mode?: string | null;
					model?: string | null;
					status?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
					verification_status?: string | null;
					started_at?: string | null;
					completed_at?: string | null;
					error_summary?: string | null;
					created_at?: string;
					updated_at?: string;
				};
				Update: {
					id?: string;
					session_id?: string;
					user_id?: string;
					task_text?: string;
					mode?: string | null;
					model?: string | null;
					status?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
					verification_status?: string | null;
					started_at?: string | null;
					completed_at?: string | null;
					error_summary?: string | null;
					created_at?: string;
					updated_at?: string;
				};
				Relationships: [];
			};
			agent_events: {
				Row: {
					id: string;
					session_id: string;
					run_id: string | null;
					user_id: string;
					sequence_number: number;
					event_type: string;
					content: Json;
					created_at: string;
				};
				Insert: {
					id?: string;
					session_id: string;
					run_id?: string | null;
					user_id: string;
					sequence_number: number;
					event_type: string;
					content?: Json;
					created_at?: string;
				};
				Update: {
					id?: string;
					session_id?: string;
					run_id?: string | null;
					user_id?: string;
					sequence_number?: number;
					event_type?: string;
					content?: Json;
					created_at?: string;
				};
				Relationships: [];
			};
			agent_usage: {
				Row: {
					id: string;
					user_id: string;
					request_id: string;
					model: string;
					input_units: number;
					output_units: number;
					estimated_cost: number | null;
					status: 'recorded' | 'adjusted' | 'voided';
					created_at: string;
				};
				Insert: {
					id?: string;
					user_id: string;
					request_id: string;
					model: string;
					input_units?: number;
					output_units?: number;
					estimated_cost?: number | null;
					status?: 'recorded' | 'adjusted' | 'voided';
					created_at?: string;
				};
				Update: {
					id?: string;
					user_id?: string;
					request_id?: string;
					model?: string;
					input_units?: number;
					output_units?: number;
					estimated_cost?: number | null;
					status?: 'recorded' | 'adjusted' | 'voided';
					created_at?: string;
				};
				Relationships: [];
			};
		};
		Views: Record<string, never>;
		Functions: Record<string, never>;
		Enums: Record<string, never>;
		CompositeTypes: Record<string, never>;
	};
}
