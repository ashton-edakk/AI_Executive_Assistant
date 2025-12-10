import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  private supabase: SupabaseClient;

  constructor(private readonly config: ConfigService) {
    const url = this.config.get<string>('SUPABASE_URL');
    const anon = this.config.get<string>('SUPABASE_ANON_KEY');
    if (!url || !anon) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY in environment');
    }
    this.supabase = createClient(url, anon, { auth: { persistSession: false } });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();

    const authHeader = req.headers['authorization'] || req.headers['Authorization'];
    if (!authHeader || !String(authHeader).startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid authorization header');
    }

    const token = String(authHeader).split(' ')[1];
    const { data, error } = await this.supabase.auth.getUser(token);
    if (error || !data?.user) {
      throw new UnauthorizedException('Invalid Supabase session token');
    }

    // Attach user (may include provider_token if you configured Google OAuth scopes)
    req.user = data.user;
    return true;
  }
}

