import {
    Handler, param, PRIV, Types, UserModel, UserNotFoundError, requireSudo, STATUS, Logger, SettingModel, Time, db, DomainModel,
    post,
    TrainingModel,
    ObjectId,
    PERM,
    ForbiddenError,
    StorageModel,
    ContestNotAttendedError,
    ProblemModel, ContestModel, BaseUserDict, ScoreboardRow,
    PermissionError, Filter,
    paginate,
    TrainingDoc,
    NotAssignedError,
    BadRequestError,
    _,
    ValidationError,
    OplogModel
} from 'hydrooj';
import Schema from 'schemastery';

class UsersManagementHandler extends Handler {
    async prepare() {
        this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
    }

    @requireSudo
    async get() {
        const cheatudocs = await UserModel.getMulti({ _id: { $gte: -1000, $ne: 1 }, cheater: true }).limit(1000).sort({ _id: 1 }).toArray();
        const udict: any[] = [];
        for (const udoc of cheatudocs) {
            const cudoc = await UserModel.getById('system', udoc._id);
            cudoc.cheater = udoc.cheater;
            cudoc.punishTime = udoc.punishTime;
            cudoc.unLockTime = udoc.unLockTime;
            udict.push(cudoc);
        }
        this.response.body = {
            udocs: udict,
        };
        this.response.pjax = 'partials/manage_users_c.html';
        this.response.template = 'manage_users_c.html';
    }

    @requireSudo
    @param('uid', Types.Int)
    @param('punishTime', Types.Int)
    async postSetCheater(domainId: string, uid: number, punishTime: number) {
        const udoc = await UserModel.getById('system', uid);
        if (!udoc) throw new UserNotFoundError(uid);
        const unLockTime = new Date(Date.now() + punishTime * 24 * 3600 * 1000);
        await UserModel.setById(uid, { cheater: true, punishTime, unLockTime });
        this.back();
    }

    @requireSudo
    @param('uid', Types.Int)
    async postCancelCheater(domainId: string, uid: number) {
        const udoc = await UserModel.getById('system', uid);
        if (!udoc) throw new UserNotFoundError(uid);
        await UserModel.setById(uid, { cheater: false, punishTime: 0, unLockTime: -1 });
        this.back();
    }
}

async function restoreCheater(_: {}, report: Function) {
    const cudocs = await UserModel.getMulti({ cheater: true }).toArray();
    for (const cudoc of cudocs) {
        const time = new Date().getTime();
        const udoc = await UserModel.getById('system', cudoc._id);
        let message = `User ${udoc.uname}(${udoc._id}) finished.`;
        if (time >= udoc._udoc?.unLockTime.getTime()) {
            await UserModel.setById(udoc._id, { cheater: false, punishTime: 0, unLockTime: -1 });
            message += 'Unlocked';
        }
        await report({
            case: {
                status: STATUS.STATUS_ACCEPTED,
                message,
                time: new Date().getTime() - time,
                memory: 0,
                score: 0,
            },
            progress: Math.floor(((+cudoc + 1) / cudocs.length) * 100),
        });
    }
    return true;
}

export async function apply(ctx) {
    ctx.Route('manage_users_c', '/manage/users_c', UsersManagementHandler);
    ctx.injectUI('ControlPanel', 'manage_users_c');
    ctx.i18n.load('zh', {
        manage_users_c: "管理作弊用户",
        training_user: "管理用户",
    });
    ctx.addScript('restoreCheater', 'Restore the Cheaters', Schema.any(), restoreCheater);
    ctx.on('task/daily', async () => {
        await global.Hydro.script.restoreCheater?.run({}, new Logger('task/restoreCheater').debug);
    });
}