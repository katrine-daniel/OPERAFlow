import { Module } from '@nestjs/common';
import { FollowupsController } from './followups.controller';
import { FollowupsService } from './followups.service';
import { MailClientFactory } from './mail-client.factory';
import { OAuthController } from './oauth.controller';
import { RulesController } from './rules.controller';

@Module({
  controllers: [OAuthController, RulesController, FollowupsController],
  providers: [FollowupsService, MailClientFactory],
  exports: [FollowupsService, MailClientFactory],
})
export class FollowupsModule {}
