export type RuntimeToolResponse = Record<string, unknown>;

export type RuntimeAction<Name extends string, T, Port> = {
	name: Name;
	run: (worktree: string, runtime: Port) => Promise<T>;
	onSuccess: (value: T) => RuntimeToolResponse;
};

export type RuntimeActionResult<T, Name extends string = string> = {
	actionName: Name;
	value: T;
	response: RuntimeToolResponse;
};

export type SessionReadAction<
	T,
	Name extends string = string,
	Port = unknown,
> = RuntimeAction<Name, T, Port>;

export type SessionReadResult<
	T,
	Name extends string = string,
> = RuntimeActionResult<T, Name>;

export type SessionWorkspaceAction<
	T,
	Name extends string = string,
	Port = unknown,
> = RuntimeAction<Name, T, Port>;

export type SessionWorkspaceResult<
	T,
	Name extends string = string,
> = RuntimeActionResult<T, Name>;

function actionSuccessResult<T, Name extends string>(
	actionName: Name,
	value: T,
	response: RuntimeToolResponse,
) {
	return { actionName, value, response };
}

export async function runRuntimeActionAtRoot<T, Name extends string, Port>(
	worktree: string,
	action: RuntimeAction<Name, T, Port>,
	runtime: Port,
): Promise<RuntimeActionResult<T, Name>> {
	const value = await action.run(worktree, runtime);
	return actionSuccessResult(action.name, value, action.onSuccess(value));
}
