import {
    i18n, pjax, request, tpl, NamedPage, Notification, ActionDialog, UserSelectAutoComplete, $, addPage
} from '@hydrooj/ui-default';

addPage(new NamedPage('manage_users_c', () => {
    const setCheaterDialogContent = $(tpl`
      <div>
        <div class="row"><div class="columns">
          <h1>${i18n('Set Cheater')}</h1>
        </div></div>
        <div class="row"><div class="columns">
          <label>
            ${i18n('Users')}
            <input name="add_user" type="text" class="textbox" autocomplete="off">
          </label>
        </div></div>
        <div class="row"><div class="columns">
          <label>
            <label>
              ${i18n('Punish Time (Day)')} 
              <input name="punish_time" type="text" class="textbox">
            </label>
          </label>
        </div></div>
      </div>
    `);
    setCheaterDialogContent.appendTo(document.body);

    const userSelect: any = UserSelectAutoComplete.getOrConstruct(
        setCheaterDialogContent.find('[name="add_user"]'),
    );

    const setCheaterDialog = new ActionDialog({
        $body: setCheaterDialogContent,
        onDispatch(action) {
            if (action === 'ok' && !userSelect.value()) {
                userSelect.focus();
                return false;
            }
            return true;
        },
    });
    setCheaterDialog.clear = function () {
        userSelect.clear();
        return this;
    };

    async function handleClickSetCheater() {
        const action = await setCheaterDialog.clear().open();
        if (action !== 'ok') return;
        const punishTime = setCheaterDialog.$dom.find('[name="punish_time"]').val();
        const user = userSelect.value();
        try {
            const res = await request.post('', {
                operation: 'set_cheater',
                uid: user._id,
                punishTime,
            });
            if (res.url && res.url !== window.location.href) window.location.href = res.url;
            else {
                Notification.success(i18n('Cheater added.'));
                pjax.request({ push: false });
            }
        } catch (error) {
            Notification.error([error.message, ...error.params].join(' '));
        }
    }

    const editCheaterDialogContent = $(tpl`
    <div>
      <div class="row"><div class="columns">
        <h1>${i18n('Edit Cheater')}</h1>
      </div></div>
      <div class="row"><div class="columns">
        <label>
          <label>
            ${i18n('Punish Time (Day)')} 
            <input name="punish_time" type="text" class="textbox">
          </label>
        </label>
      </div></div>
    </div>
  `);
    editCheaterDialogContent.appendTo(document.body);

    const editCheaterDialog = new ActionDialog({
        $body: editCheaterDialogContent,
    });

    async function handleEditCheater(ev) {
        const uid = $(ev.target).data('uid');
        const action = await editCheaterDialog.open();
        if (action !== 'ok') return;
        const punishTime = editCheaterDialog.$dom.find('[name="punish_time"]').val();
        try {
            const res = await request.post('', {
                operation: 'set_cheater',
                uid,
                punishTime,
            });
            if (res.url && res.url !== window.location.href) window.location.href = res.url;
            else {
                Notification.success(i18n('Cheater edited.'));
                pjax.request({ push: false });
            }
        } catch (error) {
            Notification.error([error.message, ...error.params].join(' '));
        }
    }

    async function handleCancelCheater(ev) {
        const uid = $(ev.target).data('uid');
        try {
            const res = await request.post('', {
                operation: 'cancel_cheater',
                uid,
            });
            if (res.url && res.url !== window.location.href) window.location.href = res.url;
            else {
                Notification.success(i18n('Cheater cancelled.'));
                pjax.request({ push: false });
            }
        } catch (error) {
            Notification.error([error.message, ...error.params].join(' '));
        }
    }

    $('[name="select_user"]').on('click', () => handleClickSetCheater());
    $(document).on('click', '[name="edit_cheater"]', handleEditCheater);
    $(document).on('click', '[name="cancel_cheater"]', handleCancelCheater);
}));