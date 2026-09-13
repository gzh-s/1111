import './button.css';

import {
    NamedPage, UserSelectAutoComplete, _, $, addPage
} from '@hydrooj/ui-default';

addPage(new NamedPage('ticket_detail', () => {
    UserSelectAutoComplete.getOrConstruct($('[name="uidOrName"]'), {
        clearDefaultValue: false,
    });
}));