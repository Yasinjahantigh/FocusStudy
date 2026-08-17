import { storeSingleton } from '../db/jsonStore';
import { AppCategory, CategorizationRule } from '../../shared/types';
import { assessApp as pureAssessApp, classifyApp as pureClassifyApp, LocalAppAssessment, RawAppInfo } from '../../shared/classification';

export class RulesEngine {
  private categories: AppCategory[] = [];
  private rules: CategorizationRule[] = [];

  constructor() {
    this.reloadRules();
  }

  public reloadRules() {
    this.categories = storeSingleton.getCategories();
    this.rules = storeSingleton.getRules().sort((a, b) => b.priority - a.priority);
  }

  public classifyApp(rawApp: RawAppInfo): AppCategory {
    return pureClassifyApp(this.categories, this.rules, rawApp);
  }

  public assessApp(rawApp: RawAppInfo): LocalAppAssessment {
    return pureAssessApp(this.categories, this.rules, rawApp);
  }

  public getCategories(): AppCategory[] {
    return this.categories;
  }

  public getRules(): CategorizationRule[] {
    return this.rules;
  }

  public addRule(rule: Omit<CategorizationRule, 'id'>): CategorizationRule {
    const newRule = storeSingleton.addRule(rule);
    this.reloadRules();
    return newRule;
  }

  public deleteRule(ruleId: string) {
    storeSingleton.deleteRule(ruleId);
    this.reloadRules();
  }
}
