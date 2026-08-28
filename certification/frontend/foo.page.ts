import { $, addPage, NamedPage, UserSelectAutoComplete } from '@hydrooj/ui-default'


addPage(new NamedPage(['certification_set'], () => {
    UserSelectAutoComplete.getOrConstruct($('[name="uidOrName"]'), {
        clearDefaultValue: false,
    });
}));


