import AppError from './app-error.js';
import { info, error as _error } from '../logger/logger.js';

const handleCaseError = err => {
    const message = `Invalid ${err.path}: ${err.value}.`;
    return new AppError(message, 400, []);
}

const handleTokenExpiryError = err => {
    const message = 'Authorization or session expired, Please login again';
    return new AppError(message, 401, []);
}

const handleNoAuthorizationProvidedError = err => {
    const message = 'No Authorization provided';
    return new AppError(message, 401, []);
}

const handleJsonWebTokenError = err => {
    const message = 'Invalid Token';
    return new AppError(message, 401, []);
}

const handleDuplicateKeyError = err => {
    const field = Object.keys(err.keyValue);
    const code = 409;
    const error = `An account with that ${field} already exists.`;
    return new AppError(error, code, field)
}

const handleValidationError = err => {
    let errors = Object.values(err.errors).map(el => el.message);
    let fields = Object.values(err.errors).map(el => el.path);
    let code = 400;
    if (errors.length > 1) {
        const formattedErrors = errors.join(', ');
        return new AppError(formattedErrors, code, fields);
    } else {
        return new AppError(errors, code, fields);
    }
}

const sendErrorDev = (err, res) => {
    res.status(err.statusCode).json({
        status: err.status,
        message: err.message,
        stack: err.stack
    });
    info("dev err", err);
    _error(err);
}

const sendErrorProd = (err, res) => {
    res.status(err.statusCode).json({
        status: err.status,
        message: err.message,
        fields: err.fields
    });
    _error(err);
}

const errorHandler = (err, req, res, next) => {
    err.statusCode = err.statusCode || 500;
    err.status = err.status || 'error';
    _error("err"+ JSON.stringify(err));

    if (err.name === 'TokenExpiredError') err = handleTokenExpiryError(err);
    if (err.name === 'NoAuthorizationProvided') err = handleNoAuthorizationProvidedError(err);
    if (err.name === 'JsonWebTokenError') err = handleJsonWebTokenError(err);

    if (process.env.NODE_ENV === 'development') {
        sendErrorDev(err, res);
    } else if (process.env.NODE_ENV === 'production') {
        try {
            let error = {...err};

            error.message = err.message ? err.message : "";
            if (err.name === 'ValidationError') error = handleValidationError(error);
            if (err.name === 'CastError') error = handleCaseError(error);
            if (err.code && err.code === 11000) error = handleDuplicateKeyError(error);

            sendErrorProd(error, res);
        } catch (e) {
            res.status(500).json({
                status: 'error',
                message: 'Something went wrong'
            })
        }
    }
}

export default errorHandler;
